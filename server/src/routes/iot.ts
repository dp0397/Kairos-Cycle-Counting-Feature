import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bus, config, prisma, stateFilter, type DomainEvent } from '../lib/core.js';
import { ingestBle, ingestTelemetry } from '../services/iotService.js';

export async function iotRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };
  // Gateways/devices authenticate with a shared key, not a user JWT.
  const gatewayAuth = {
    preHandler: async (req: any, reply: any) => {
      if (req.headers['x-gateway-key'] !== config.gatewayKey) return reply.code(401).send({ error: 'bad gateway key' });
    },
  };

  app.post('/iot/ble/ingest', gatewayAuth, async (req, reply) => {
    const b = z.object({
      gatewayId: z.string(),
      readings: z.array(z.object({
        mac: z.string(), rssi: z.number().int(), batteryV: z.number().optional(),
        pvVoltage: z.number().optional(), ts: z.string().datetime().optional(),
      })).max(2000),
    }).parse(req.body);
    try { return await ingestBle(b.gatewayId, b.readings); }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  app.post('/iot/telemetry', gatewayAuth, async (req) => {
    const b = z.object({
      warehouseId: z.string(), sensorId: z.string().optional(), kind: z.string(),
      value: z.number(), unit: z.string(), ts: z.string().datetime().optional(),
    }).parse(req.body);
    await ingestTelemetry(b);
    return { ok: true };
  });

  app.get('/assets', auth, async (req) => {
    const q = z.object({ warehouseId: z.string(), zone: z.string().optional() }).parse(req.query);
    return prisma.asset.findMany({
      where: { warehouseId: q.warehouseId, ...(q.zone ? { zoneCode: q.zone } : {}) },
      include: { tag: true }, orderBy: { updatedAt: 'desc' },
    });
  });

  app.get('/assets/:id/location', auth, async (req, reply) => {
    const { id } = req.params as { id: string };
    const a = await prisma.asset.findUnique({ where: { id }, include: { tag: { include: { gateway: true } } } });
    if (!a) return reply.code(404).send({ error: 'not found' });
    const trail = a.tag
      ? await prisma.bleReading.findMany({ where: { tagId: a.tag.id }, orderBy: { ts: 'desc' }, take: 20, include: { gateway: { select: { name: true, zoneCode: true } } } })
      : [];
    return { asset: a, trail: trail.map((t) => ({ ts: t.ts, rssi: t.rssi, gateway: t.gateway.name, zone: t.gateway.zoneCode })) };
  });

  app.get('/alerts', auth, async (req) => {
    const q = z.object({ warehouseId: z.string().optional(), open: z.coerce.boolean().optional() }).parse(req.query);
    return prisma.alert.findMany({
      where: { warehouse: stateFilter, ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}), ...(q.open ? { ackAt: null } : {}) },
      orderBy: { ts: 'desc' }, take: 100, include: { warehouse: { select: { name: true } } },
    });
  });

  app.post('/alerts/:id/ack', auth, async (req) => {
    const { id } = req.params as { id: string };
    return prisma.alert.update({ where: { id }, data: { ackAt: new Date() } });
  });

  /** 8D digital-twin state: 3D geometry (floor plan, zones, gateways, sensors), live assets, latest telemetry. */
  app.get('/twin/:warehouseId/state', auth, async (req, reply) => {
    const { warehouseId } = req.params as { warehouseId: string };
    const wh = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      include: { zones: true, gateways: true, sensors: true, assets: { include: { tag: true } } },
    });
    if (!wh) return reply.code(404).send({ error: 'not found' });
    const since = new Date(Date.now() - 60 * 60_000);
    const history = await prisma.telemetryEvent.findMany({
      where: { warehouseId, ts: { gte: since } }, orderBy: { ts: 'asc' }, take: 1000,
    });
    return {
      asOf: new Date().toISOString(),
      warehouse: { id: wh.id, name: wh.name, code: wh.code },
      zones: wh.zones,
      gateways: wh.gateways.map((g) => ({ id: g.id, name: g.name, x: g.x, y: g.y, zone: g.zoneCode, lastSeen: g.lastSeen })),
      sensors: wh.sensors.map((s) => ({
        ...s,
        status: s.lastValue == null ? 'UNKNOWN' : s.lastValue >= s.criticalAbove ? 'CRITICAL' : s.lastValue >= s.warnAbove ? 'WARN' : 'OK',
      })),
      assets: wh.assets.map((a) => ({
        id: a.id, label: a.label, commodity: a.commodity, mt: a.mt, zone: a.zoneCode, x: a.x, y: a.y,
        batteryV: a.tag?.batteryV, pvVoltage: a.tag?.pvVoltage, lastSeen: a.tag?.lastSeen,
      })),
      history: history.map((h) => ({ kind: h.kind, value: h.value, unit: h.unit, ts: h.ts, sensorId: h.sensorId })),
    };
  });

  /** Server-sent events: live telemetry, asset moves, alerts. Token passed as ?token= (EventSource can't set headers). */
  app.get('/telemetry/stream', async (req, reply) => {
    const q = z.object({ token: z.string(), warehouseId: z.string().optional() }).parse(req.query);
    try { app.jwt.verify(q.token); } catch { return reply.code(401).send({ error: 'unauthorized' }); }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive',
      'Access-Control-Allow-Origin': config.corsOrigin,
    });
    reply.raw.write(': connected\n\n');
    const send = (e: DomainEvent) => {
      if (q.warehouseId && e.warehouseId !== q.warehouseId) return;
      reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    };
    const off = bus.subscribe(send);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => { off(); clearInterval(ping); });
    return reply; // hijacked
  });
}
