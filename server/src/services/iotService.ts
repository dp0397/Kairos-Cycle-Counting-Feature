import { bus, prisma } from '../lib/core.js';

export interface BleBatchItem {
  mac: string;
  rssi: number;
  batteryV?: number;
  pvVoltage?: number;
  ts?: string;
}

const LOW_BATTERY_V = 2.8;
const LOW_PV_V = 0.15;

/**
 * Ingest a batch from one gateway. Replaces manual cycle counting: each tag's asset is
 * located at the gateway that hears it loudest (RSSI), resolved to a floor-plan zone.
 * (Multi-gateway trilateration would slot in here once ≥3 gateways hear the same tag.)
 */
export async function ingestBle(gatewayId: string, items: BleBatchItem[]) {
  const gw = await prisma.gateway.findUnique({ where: { id: gatewayId } });
  if (!gw) throw new Error('unknown gateway');
  await prisma.gateway.update({ where: { id: gw.id }, data: { lastSeen: new Date() } });

  const zones = await prisma.zone.findMany({ where: { warehouseId: gw.warehouseId } });
  let accepted = 0;

  for (const it of items) {
    const tag = await prisma.bleTag.findUnique({ where: { mac: it.mac }, include: { asset: true } });
    if (!tag) continue; // unknown tags are ignored (not provisioned)
    accepted++;
    const ts = it.ts ? new Date(it.ts) : new Date();

    await prisma.bleReading.create({ data: { tagId: tag.id, gatewayId, rssi: it.rssi, ts } });

    // Keep the strongest-gateway view: only move the tag if this gateway is at least as loud.
    const prevLoud = tag.gatewayId && tag.gatewayId !== gatewayId && tag.lastSeen && ts.getTime() - tag.lastSeen.getTime() < 15_000 && (tag.lastRssi ?? -999) > it.rssi;
    if (!prevLoud) {
      await prisma.bleTag.update({
        where: { id: tag.id },
        data: {
          gatewayId,
          lastRssi: it.rssi,
          lastSeen: ts,
          batteryV: it.batteryV ?? tag.batteryV,
          pvVoltage: it.pvVoltage ?? tag.pvVoltage,
        },
      });
      if (tag.asset) {
        const zone = zones.find((z) => z.code === gw.zoneCode) ?? null;
        const moved = tag.asset.zoneCode !== (zone?.code ?? null);
        await prisma.asset.update({
          where: { id: tag.asset.id },
          data: { zoneCode: zone?.code ?? null, x: gw.x, y: gw.y, updatedAt: ts },
        });
        if (moved) {
          bus.publish({
            type: 'asset.moved', warehouseId: gw.warehouseId, assetId: tag.asset.id,
            label: tag.asset.label, zone: zone?.code ?? null, x: gw.x, y: gw.y,
          });
        }
      }
    }

    if (it.batteryV !== undefined && it.batteryV < LOW_BATTERY_V) {
      await raiseAlert(gw.warehouseId, 'WARN', 'TAG_LOW_BATTERY', `Tag ${it.mac} storage cell at ${it.batteryV.toFixed(2)} V`);
    }
    if (it.pvVoltage !== undefined && it.pvVoltage < LOW_PV_V && (it.batteryV ?? 3) < 3.1) {
      await raiseAlert(gw.warehouseId, 'INFO', 'TAG_NO_HARVEST', `Tag ${it.mac} PV cell not harvesting (${it.pvVoltage.toFixed(2)} V)`);
    }
  }
  return { accepted, received: items.length };
}

export interface TelemetryInput {
  warehouseId: string;
  sensorId?: string;
  kind: string;
  value: number;
  unit: string;
  ts?: string;
}

/** Store a structural / environmental reading, update the sensor, raise threshold alerts. */
export async function ingestTelemetry(t: TelemetryInput) {
  const ts = t.ts ? new Date(t.ts) : new Date();
  await prisma.telemetryEvent.create({
    data: { warehouseId: t.warehouseId, sensorId: t.sensorId, kind: t.kind, value: t.value, unit: t.unit, ts },
  });
  bus.publish({ type: 'telemetry', warehouseId: t.warehouseId, kind: t.kind, value: t.value, unit: t.unit, ts: ts.toISOString(), sensorId: t.sensorId });

  if (!t.sensorId) return;
  const s = await prisma.structuralSensor.update({ where: { id: t.sensorId }, data: { lastValue: t.value, lastAt: ts } });
  if (t.value >= s.criticalAbove) {
    await raiseAlert(t.warehouseId, 'CRITICAL', `STRUCTURAL_${s.kind}`, `${s.kind} at ${s.location}: ${t.value}${s.unit} ≥ critical ${s.criticalAbove}${s.unit}`);
  } else if (t.value >= s.warnAbove) {
    await raiseAlert(t.warehouseId, 'WARN', `STRUCTURAL_${s.kind}`, `${s.kind} at ${s.location}: ${t.value}${s.unit} ≥ warning ${s.warnAbove}${s.unit}`);
  }
}

/** De-duplicates: no new alert if an unacknowledged one of the same kind+message exists in the last 10 min. */
async function raiseAlert(warehouseId: string, severity: 'INFO' | 'WARN' | 'CRITICAL', kind: string, message: string) {
  const since = new Date(Date.now() - 10 * 60_000);
  const dup = await prisma.alert.findFirst({ where: { warehouseId, kind, message, ts: { gte: since }, ackAt: null } });
  if (dup) return;
  const a = await prisma.alert.create({ data: { warehouseId, severity, kind, message } });
  bus.publish({ type: 'alert', warehouseId, id: a.id, severity, kind, message });
}
