import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { bus, prisma } from '../lib/core.js';
import { depotDarpan, smartPds, syncAdapter } from '../adapters/index.js';
import { generatePick, suggestPutaway } from '../services/wmsService.js';

/** Allowed inbound trailer transitions. The bus events are the hook for a future driver check-in module. */
const NEXT: Record<string, string[]> = {
  SCHEDULED: ['ARRIVED', 'CANCELLED'],
  ARRIVED: ['DOCKED', 'CANCELLED'],
  DOCKED: ['UNLOADING'],
  UNLOADING: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export async function wmsRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };
  const ops = { preHandler: [app.authenticate, app.requireRole('CWC_ADMIN', 'REGIONAL_MGR')] };

  // ── Inbound trailers ──
  app.get('/inbound/trailers', auth, async (req) => {
    const q = z.object({ warehouseId: z.string().optional() }).parse(req.query);
    return prisma.inboundTrailer.findMany({
      where: { ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}), status: { not: 'CANCELLED' } },
      orderBy: { scheduledAt: 'asc' }, take: 200, include: { warehouse: { select: { name: true } }, putaways: true },
    });
  });

  app.post('/inbound/trailers', ops, async (req, reply) => {
    const b = z.object({
      warehouseId: z.string(), carrier: z.string(), plate: z.string(), commodity: z.string(),
      expectedMT: z.number().positive(), scheduledAt: z.coerce.date(),
    }).parse(req.body);
    const t = await prisma.inboundTrailer.create({ data: b });
    bus.publish({ type: 'trailer.scheduled', warehouseId: t.warehouseId, trailerId: t.id });
    return reply.code(201).send(t);
  });

  app.patch('/inbound/trailers/:id/status', ops, async (req, reply) => {
    const { id } = req.params as { id: string };
    const b = z.object({ status: z.enum(['ARRIVED', 'DOCKED', 'UNLOADING', 'COMPLETED', 'CANCELLED']), doorNo: z.number().int().positive().optional() }).parse(req.body);
    const t = await prisma.inboundTrailer.findUnique({ where: { id } });
    if (!t) return reply.code(404).send({ error: 'not found' });
    if (!NEXT[t.status].includes(b.status)) return reply.code(409).send({ error: `${t.status} → ${b.status} not allowed` });
    if (b.status === 'DOCKED' && !(b.doorNo ?? t.doorNo)) return reply.code(400).send({ error: 'doorNo required to dock' });

    const u = await prisma.inboundTrailer.update({
      where: { id },
      data: {
        status: b.status,
        ...(b.status === 'ARRIVED' ? { arrivedAt: new Date() } : {}),
        ...(b.doorNo ? { doorNo: b.doorNo } : {}),
        ...(b.status === 'COMPLETED' ? { completedAt: new Date() } : {}),
      },
    });
    if (b.status === 'ARRIVED') bus.publish({ type: 'trailer.arrived', warehouseId: u.warehouseId, trailerId: id });
    if (b.status === 'DOCKED') bus.publish({ type: 'trailer.door_assigned', warehouseId: u.warehouseId, trailerId: id });
    if (b.status === 'COMPLETED') bus.publish({ type: 'trailer.completed', warehouseId: u.warehouseId, trailerId: id });
    return u;
  });

  // ── System-directed putaway ──
  app.post('/putaway/suggest', ops, async (req, reply) => {
    const b = z.object({ trailerId: z.string(), needCold: z.boolean().optional(), create: z.boolean().default(false) }).parse(req.body);
    const t = await prisma.inboundTrailer.findUnique({ where: { id: b.trailerId } });
    if (!t) return reply.code(404).send({ error: 'trailer not found' });
    const s = await suggestPutaway(t.warehouseId, t.commodity, t.expectedMT, b.needCold);
    if (!s) return reply.code(409).send({ error: 'No zone can hold this lot — consider overflow to flex capacity' });
    const task = b.create
      ? await prisma.putawayTask.create({ data: { trailerId: t.id, zoneId: s.zone.id, mt: t.expectedMT, reason: s.reason } })
      : null;
    return { zone: s.zone, reason: s.reason, task };
  });

  app.get('/putaway/tasks', auth, async (req) => {
    const q = z.object({ warehouseId: z.string().optional(), status: z.string().optional() }).parse(req.query);
    return prisma.putawayTask.findMany({
      where: { ...(q.status ? { status: q.status as never } : {}), ...(q.warehouseId ? { trailer: { warehouseId: q.warehouseId } } : {}) },
      include: { zone: true, trailer: true }, orderBy: { createdAt: 'desc' }, take: 100,
    });
  });

  app.post('/putaway/tasks/:id/complete', ops, async (req, reply) => {
    const { id } = req.params as { id: string };
    const task = await prisma.putawayTask.findUnique({ where: { id }, include: { trailer: true } });
    if (!task) return reply.code(404).send({ error: 'not found' });
    if (task.status === 'DONE') return reply.code(409).send({ error: 'already done' });
    await prisma.$transaction([
      prisma.putawayTask.update({ where: { id }, data: { status: 'DONE', doneAt: new Date() } }),
      prisma.zone.update({ where: { id: task.zoneId }, data: { usedMT: { increment: task.mt } } }),
      prisma.warehouse.update({ where: { id: task.trailer.warehouseId }, data: { usedMT: { increment: task.mt } } }),
      prisma.inventoryLot.create({
        data: {
          warehouseId: task.trailer.warehouseId, zoneId: task.zoneId, commodity: task.trailer.commodity,
          mt: task.mt, receivedAt: new Date(), expiryAt: new Date(Date.now() + 180 * 86_400_000),
        },
      }),
    ]);
    return { ok: true };
  });

  // ── Rule-driven picking ──
  app.get('/picking/rules', auth, async (req) => {
    const q = z.object({ warehouseId: z.string() }).parse(req.query);
    return prisma.pickRule.findMany({ where: { warehouseId: q.warehouseId }, orderBy: { priority: 'asc' } });
  });
  app.post('/picking/rules', ops, async (req, reply) => {
    const b = z.object({
      warehouseId: z.string(), name: z.string(), strategy: z.enum(['FIFO', 'FEFO', 'ZONE_FIRST']),
      priority: z.number().int().default(100), commodity: z.string().nullable().optional(),
    }).parse(req.body);
    return reply.code(201).send(await prisma.pickRule.create({ data: b }));
  });
  app.get('/picking/tasks', auth, async (req) => {
    const q = z.object({ warehouseId: z.string() }).parse(req.query);
    return prisma.pickTask.findMany({ where: { warehouseId: q.warehouseId }, orderBy: { createdAt: 'desc' }, take: 50 });
  });
  app.post('/picking/tasks/generate', ops, async (req, reply) => {
    const b = z.object({ warehouseId: z.string(), orderRef: z.string(), commodity: z.string(), mt: z.number().positive() }).parse(req.body);
    const r = await generatePick(b.warehouseId, b.orderRef, b.commodity, b.mt);
    if ('error' in r) return reply.code(409).send(r);
    return reply.code(201).send(r.task);
  });

  // ── Government platform widgets ──
  app.get('/integrations/smart-pds/summary', auth, async () => ({ mode: smartPds.mode, data: await smartPds.fetchSummary() }));
  app.get('/integrations/depot-darpan/summary', auth, async () => ({ mode: depotDarpan.mode, data: await depotDarpan.fetchSummary() }));
  app.get('/integrations/status', auth, async () => {
    const out: Record<string, unknown> = {};
    for (const system of ['SMART_PDS', 'DEPOT_DARPAN']) {
      out[system] = await prisma.integrationSync.findFirst({ where: { system }, orderBy: { createdAt: 'desc' }, select: { status: true, mode: true, createdAt: true, error: true } });
    }
    return out;
  });
  app.post('/integrations/:name/sync', ops, async (req, reply) => {
    const { name } = req.params as { name: string };
    const a = name === 'smart-pds' ? smartPds : name === 'depot-darpan' ? depotDarpan : null;
    if (!a) return reply.code(404).send({ error: 'unknown integration' });
    try { return { mode: a.mode, data: await syncAdapter(a as never) }; }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
}
