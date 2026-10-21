/**
 * Demo IoT simulator: plays the role of BLE gateways + structural sensors for the seeded
 * CWC Deesa site. Posts to the real ingest endpoints, so it exercises the full pipeline.
 *
 *   npm run simulate            # normal drift
 *   npm run simulate -- --spike # occasionally pushes a sensor past warn/critical
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const API = process.env.API_URL ?? 'http://localhost:4391/api/v1';
const KEY = process.env.GATEWAY_KEY ?? 'dev-gateway-key';
const spike = process.argv.includes('--spike');

async function post(path: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-gateway-key': KEY }, body: JSON.stringify(body) });
  if (!r.ok) console.error(path, r.status, await r.text());
}

async function main() {
  const wh = await prisma.warehouse.findUnique({ where: { code: 'GJ-CWC-DEESA' }, include: { gateways: true, sensors: true } });
  if (!wh) throw new Error('Run the seed first');
  const tags = await prisma.bleTag.findMany();
  const state = new Map(tags.map((t) => [t.mac, { gw: wh.gateways.findIndex((g) => g.id === t.gatewayId), batt: t.batteryV ?? 3.1 }]));
  const sval = new Map(wh.sensors.map((s) => [s.id, s.warnAbove * 0.55]));
  console.log(`Simulating ${tags.length} tags and ${wh.sensors.length} sensors at ${wh.name} → ${API}`);

  let tick = 0;
  setInterval(async () => {
    tick++;
    // Each gateway reports the tags it currently "hears" (strong) plus a weaker neighbour echo.
    const byGw = new Map<string, any[]>();
    for (const [mac, s] of state) {
      if (Math.random() < 0.06) s.gw = Math.floor(Math.random() * wh.gateways.length); // pallet moved
      s.batt = Math.max(2.6, s.batt - Math.random() * 0.002);
      const g = wh.gateways[s.gw];
      const arr = byGw.get(g.id) ?? [];
      arr.push({ mac, rssi: -45 - Math.floor(Math.random() * 15), batteryV: +s.batt.toFixed(3), pvVoltage: +(0.3 + Math.random() * 1.0).toFixed(2) });
      byGw.set(g.id, arr);
      const echo = wh.gateways[(s.gw + 1) % wh.gateways.length];
      const e = byGw.get(echo.id) ?? [];
      e.push({ mac, rssi: -78 - Math.floor(Math.random() * 10) });
      byGw.set(echo.id, e);
    }
    for (const [gatewayId, readings] of byGw) await post('/iot/ble/ingest', { gatewayId, readings });

    for (const s of wh.sensors) {
      let v = sval.get(s.id)! + (Math.random() - 0.5) * s.warnAbove * 0.04;
      if (spike && tick % 25 === 0 && s.kind === 'TILT') v = s.criticalAbove * 1.05;
      v = Math.max(0, v);
      sval.set(s.id, v + (spike ? 0 : (s.warnAbove * 0.55 - v) * 0.1)); // mean-revert
      await post('/iot/telemetry', { warehouseId: wh.id, sensorId: s.id, kind: s.kind, value: +v.toFixed(2), unit: s.unit });
    }
  }, 3000);
}
main();
