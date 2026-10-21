/**
 * Phase-1 seed: Gujarat only.
 *
 * ⚠ ILLUSTRATIVE DATA. Locations are real towns, but facility names, capacities, tariffs,
 * production forecasts and provider details are invented for demo purposes. Replace with
 * CWC's warehouse register / Depot Darpan export and state horticulture statistics.
 */
import { PrismaClient, WarehouseKind } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const day = 86_400_000;

type W = {
  code: string; name: string; kind: WarehouseKind; district: string; lat: number; lng: number;
  cap: number; util: number; tariff: number; cold?: boolean; provider?: string; dd?: boolean;
};

const GRAINS = ['wheat', 'rice', 'groundnut', 'cotton'];
const POTATO = ['potato', 'onion'];

const warehouses: W[] = [
  // CWC / SWC network
  { code: 'GJ-CWC-AMD', name: 'CWC Ahmedabad', kind: 'CWC', district: 'Ahmedabad', lat: 23.07, lng: 72.65, cap: 38000, util: 0.74, tariff: 285, dd: true },
  { code: 'GJ-CWC-DEESA', name: 'CWC Deesa', kind: 'CWC', district: 'Banaskantha', lat: 24.25, lng: 72.19, cap: 24000, util: 0.9, tariff: 310, cold: true, dd: true },
  { code: 'GJ-CWC-PLN', name: 'CWC Palanpur', kind: 'CWC', district: 'Banaskantha', lat: 24.18, lng: 72.43, cap: 18000, util: 0.86, tariff: 295, cold: true, dd: true },
  { code: 'GJ-CWC-MSN', name: 'CWC Mehsana', kind: 'CWC', district: 'Mehsana', lat: 23.6, lng: 72.39, cap: 16000, util: 0.78, tariff: 290, dd: true },
  { code: 'GJ-CWC-KLL', name: 'CWC Kalol', kind: 'CWC', district: 'Gandhinagar', lat: 23.25, lng: 72.49, cap: 14000, util: 0.69, tariff: 280, cold: true, dd: true },
  { code: 'GJ-CWC-HMT', name: 'CWC Himmatnagar', kind: 'CWC', district: 'Sabarkantha', lat: 23.6, lng: 72.96, cap: 12000, util: 0.62, tariff: 275, cold: true, dd: true },
  { code: 'GJ-CWC-RJK', name: 'CWC Rajkot', kind: 'CWC', district: 'Rajkot', lat: 22.3, lng: 70.82, cap: 32000, util: 0.66, tariff: 275, dd: true },
  { code: 'GJ-CWC-SRT', name: 'CWC Surat', kind: 'CWC', district: 'Surat', lat: 21.1, lng: 72.86, cap: 26000, util: 0.58, tariff: 295, dd: true },
  { code: 'GJ-CWC-VDR', name: 'CWC Vadodara', kind: 'CWC', district: 'Vadodara', lat: 22.33, lng: 73.15, cap: 30000, util: 0.7, tariff: 280, dd: true },
  { code: 'GJ-CWC-BVN', name: 'CWC Bhavnagar', kind: 'CWC', district: 'Bhavnagar', lat: 21.77, lng: 72.13, cap: 15000, util: 0.55, tariff: 265, dd: true },
  { code: 'GJ-CWC-GDM', name: 'CWC Gandhidham', kind: 'CWC', district: 'Kutch', lat: 23.08, lng: 70.14, cap: 22000, util: 0.64, tariff: 300, dd: false },
  { code: 'GJ-SWC-ANN', name: 'GSWC Anand', kind: 'SWC', district: 'Anand', lat: 22.55, lng: 72.95, cap: 10000, util: 0.6, tariff: 270, dd: true },
  { code: 'GJ-SWC-JND', name: 'GSWC Junagadh', kind: 'SWC', district: 'Junagadh', lat: 21.52, lng: 70.46, cap: 11000, util: 0.72, tariff: 265, dd: true },
  { code: 'GJ-SWC-PTN', name: 'GSWC Patan', kind: 'SWC', district: 'Patan', lat: 23.85, lng: 72.12, cap: 9000, util: 0.81, tariff: 270, cold: true, dd: false },

  // Private 3PL / 2PL — flexible capacity sellers
  { code: 'GJ-P-DEESA1', name: 'Banas Cold Chain, Deesa', kind: 'PRIVATE_3PL', district: 'Banaskantha', lat: 24.27, lng: 72.17, cap: 12000, util: 0.55, tariff: 340, cold: true, provider: 'Banas Cold Chain LLP' },
  { code: 'GJ-P-DEESA2', name: 'Aravalli Agri Storage, Deesa', kind: 'PRIVATE_2PL', district: 'Banaskantha', lat: 24.22, lng: 72.22, cap: 8000, util: 0.6, tariff: 320, cold: true, provider: 'Aravalli Agri Storage' },
  { code: 'GJ-P-PLN1', name: 'Sundha Logistics Park, Palanpur', kind: 'PRIVATE_3PL', district: 'Banaskantha', lat: 24.15, lng: 72.4, cap: 15000, util: 0.5, tariff: 335, cold: true, provider: 'Sundha Logistics' },
  { code: 'GJ-P-PTN1', name: 'Patan Frost Storage', kind: 'PRIVATE_2PL', district: 'Patan', lat: 23.87, lng: 72.1, cap: 6000, util: 0.45, tariff: 310, cold: true, provider: 'Patan Frost Storage' },
  { code: 'GJ-P-MSN1', name: 'Uttar Gujarat 3PL Hub, Mehsana', kind: 'PRIVATE_3PL', district: 'Mehsana', lat: 23.58, lng: 72.35, cap: 20000, util: 0.4, tariff: 345, cold: true, provider: 'Uttar Gujarat 3PL' },
  { code: 'GJ-P-HMT1', name: 'Sabar Coldstores, Himmatnagar', kind: 'PRIVATE_2PL', district: 'Sabarkantha', lat: 23.62, lng: 72.99, cap: 9000, util: 0.52, tariff: 315, cold: true, provider: 'Sabar Coldstores' },
  { code: 'GJ-P-AMD1', name: 'Sanand Distribution Centre', kind: 'PRIVATE_3PL', district: 'Ahmedabad', lat: 22.99, lng: 72.38, cap: 25000, util: 0.62, tariff: 360, cold: true, provider: 'Sundha Logistics' },
  { code: 'GJ-P-KLL1', name: 'Kalol Agro Warehousing', kind: 'PRIVATE_2PL', district: 'Gandhinagar', lat: 23.23, lng: 72.51, cap: 7000, util: 0.58, tariff: 325, cold: true, provider: 'Aravalli Agri Storage' },
  { code: 'GJ-P-MDS1', name: 'Modasa Chill Logistics', kind: 'PRIVATE_3PL', district: 'Aravalli', lat: 23.46, lng: 73.3, cap: 5000, util: 0.35, tariff: 305, cold: true, provider: 'Modasa Chill Logistics' },
  { code: 'GJ-P-RJK1', name: 'Saurashtra Grain Depot, Rajkot', kind: 'PRIVATE_3PL', district: 'Rajkot', lat: 22.28, lng: 70.77, cap: 14000, util: 0.5, tariff: 290, provider: 'Saurashtra Grain Depot' },
];

const providers = [
  { name: 'Banas Cold Chain LLP', tier: 'TRUSTED', rating: 4.6, onTimeRate: 0.96 },
  { name: 'Aravalli Agri Storage', tier: 'VERIFIED', rating: 4.1, onTimeRate: 0.91 },
  { name: 'Sundha Logistics', tier: 'TRUSTED', rating: 4.4, onTimeRate: 0.94 },
  { name: 'Patan Frost Storage', tier: 'VERIFIED', rating: 3.8, onTimeRate: 0.88 },
  { name: 'Uttar Gujarat 3PL', tier: 'TRUSTED', rating: 4.3, onTimeRate: 0.93 },
  { name: 'Sabar Coldstores', tier: 'VERIFIED', rating: 3.9, onTimeRate: 0.85 },
  { name: 'Modasa Chill Logistics', tier: 'UNVERIFIED', rating: 3.2, onTimeRate: 0.8 },
  { name: 'Saurashtra Grain Depot', tier: 'VERIFIED', rating: 4.0, onTimeRate: 0.9 },
] as const;

const production = [
  // [district, lat, lng, commodity, forecastMT, harvest window]
  ['Banaskantha', 24.17, 72.43, 'potato', 1_650_000, 'rabi'],
  ['Sabarkantha', 23.6, 72.97, 'potato', 520_000, 'rabi'],
  ['Aravalli', 23.46, 73.3, 'potato', 310_000, 'rabi'],
  ['Gandhinagar', 23.22, 72.65, 'potato', 240_000, 'rabi'],
  ['Mehsana', 23.6, 72.37, 'potato', 120_000, 'rabi'],
  ['Patan', 23.85, 72.12, 'potato', 95_000, 'rabi'],
  ['Junagadh', 21.52, 70.46, 'groundnut', 480_000, 'kharif'],
  ['Rajkot', 22.3, 70.8, 'groundnut', 420_000, 'kharif'],
  ['Surendranagar', 22.73, 71.64, 'cotton', 390_000, 'kharif'],
] as const;

async function main() {
  console.log('Seeding (Gujarat, illustrative data)…');
  // wipe in dependency order
  for (const m of ['bleReading', 'telemetryEvent', 'alert', 'bleTag', 'asset', 'gateway', 'structuralSensor', 'pickTask', 'pickRule',
    'putawayTask', 'inventoryLot', 'inboundTrailer', 'zone', 'bookingLine', 'booking', 'capacitySlot', 'routingRecommendation',
    'integrationSync', 'auditLog', 'user', 'warehouse', 'provider', 'commodityProduction'] as const) {
    await (prisma[m] as any).deleteMany();
  }

  const provIds: Record<string, string> = {};
  for (const p of providers) {
    const r = await prisma.provider.create({ data: { ...p, verifiedAt: p.tier === 'UNVERIFIED' ? null : new Date() } });
    provIds[p.name] = r.id;
  }

  const hash = await bcrypt.hash('demo1234', 10); // DEV ONLY credentials
  const users = [
    ['admin@cwc.local', 'CWC Admin', 'CWC_ADMIN', undefined],
    ['manager@cwc.local', 'Regional Manager, Gujarat', 'REGIONAL_MGR', undefined],
    ['partner@banas.local', 'Banas Cold Chain (3PL)', 'PARTNER_3PL', 'Banas Cold Chain LLP'],
    ['auditor@cwc.local', 'Auditor', 'AUDITOR', undefined],
  ] as const;
  for (const [email, name, role, prov] of users)
    await prisma.user.create({ data: { email, name, role, passwordHash: hash, providerId: prov ? provIds[prov] : null } });

  const whIds: Record<string, string> = {};
  for (const w of warehouses) {
    const priv = w.kind.startsWith('PRIVATE');
    const row = await prisma.warehouse.create({
      data: {
        code: w.code, name: w.name, kind: w.kind, stateCode: 'GJ', district: w.district, lat: w.lat, lng: w.lng,
        capacityMT: w.cap, usedMT: Math.round(w.cap * w.util), tariffPerMTMonth: w.tariff,
        commodities: w.cold ? [...POTATO, ...GRAINS.slice(0, 2)] : [...GRAINS, ...(priv ? [] : [])],
        coldStorage: !!w.cold, certifications: priv ? ['FSSAI'] : ['FSSAI', 'ISO 9001'],
        depotDarpanId: w.dd ? `DD-GJ-${w.code.split('-').pop()}` : null,
        providerId: w.provider ? provIds[w.provider] : null,
      },
    });
    whIds[w.code] = row.id;

    // Zones A–D: 4 equal quarters on a 100×60 m floor plan, fill proportional to utilisation (with spread).
    const spread = [1.15, 1.05, 0.9, 0.9];
    for (const [i, code] of ['A', 'B', 'C', 'D'].entries()) {
      const zc = w.cap / 4;
      await prisma.zone.create({
        data: {
          warehouseId: row.id, code, capacityMT: zc, usedMT: Math.min(zc, Math.round(zc * w.util * spread[i])),
          commodityAffinity: w.cold ? (i < 2 ? ['potato'] : ['onion', 'potato']) : (i < 2 ? ['wheat', 'rice'] : ['groundnut', 'cotton']),
          cold: !!w.cold, x: (i % 2) * 50, y: Math.floor(i / 2) * 30, w: 50, h: 30,
        },
      });
    }
  }

  // Flex capacity offers (private only)
  for (const w of warehouses.filter((x) => x.kind.startsWith('PRIVATE'))) {
    const free = Math.round(w.cap * (1 - w.util));
    const windows = [
      { s: '2027-02-10', e: '2027-12-15', share: 0.5, price: 8.5 + (w.tariff - 300) / 12, ready: 24 },
      { s: '2027-03-01', e: '2027-07-31', share: 0.25, price: 9.5 + (w.tariff - 300) / 12, ready: 8 },
    ];
    for (const win of windows)
      await prisma.capacitySlot.create({
        data: {
          warehouseId: whIds[w.code], startDate: new Date(win.s), endDate: new Date(win.e),
          pallets: Math.round(free * win.share), pricePerPalletDay: Math.round(win.price * 100) / 100,
          handlingPerPallet: 12 + Math.round(Math.abs(w.tariff - 300) / 10), readyHours: win.ready, source: 'SEED',
        },
      });
  }

  for (const [district, lat, lng, commodity, mt, season] of production) {
    await prisma.commodityProduction.create({
      data: {
        district, lat, lng, commodity, season: '2026-27', forecastMT: mt,
        harvestStart: new Date(season === 'rabi' ? '2027-01-15' : '2026-10-15'),
        harvestEnd: new Date(season === 'rabi' ? '2027-03-20' : '2026-12-31'),
      },
    });
  }

  // ── Demo warehouse with full WMS/IoT data: CWC Deesa ──
  const demo = whIds['GJ-CWC-DEESA'];
  const zones = await prisma.zone.findMany({ where: { warehouseId: demo }, orderBy: { code: 'asc' } });

  const gws = [];
  for (const z of zones)
    gws.push(await prisma.gateway.create({ data: { warehouseId: demo, name: `GW-${z.code}`, x: z.x + z.w / 2, y: z.y + z.h / 2, zoneCode: z.code } }));

  const sensors: [string, string, number, number, number, string][] = [
    ['TILT', 'North wall column N1', 0.6, 1.0, 0.5, '°'],
    ['TILT', 'South wall column S2', 0.6, 1.0, 0.5, '°'],
    ['LOAD', 'Roof truss T3', 70, 90, 55, '% of rated'],
    ['CRACK', 'Floor slab joint F4', 1.2, 2.0, 0.6, 'mm'],
    ['VIBRATION', 'Dock apron D1', 4.5, 7.0, 1.5, 'mm/s'],
    ['HUMIDITY', 'Zone B ambient', 88, 94, 80, '% RH'],
  ];
  for (const [i, [kind, location, warn, crit, , unit]] of sensors.entries())
    await prisma.structuralSensor.create({
      data: { warehouseId: demo, kind: kind as never, location, warnAbove: warn, criticalAbove: crit, unit, x: 15 + i * 15, y: 10 + (i % 3) * 20 },
    });

  for (let i = 1; i <= 12; i++) {
    const z = zones[(i - 1) % 4];
    const a = await prisma.asset.create({
      data: {
        warehouseId: demo, label: `PLT-${String(i).padStart(4, '0')}`, commodity: 'potato', mt: 1.1,
        zoneCode: z.code, x: z.x + z.w / 2, y: z.y + z.h / 2,
      },
    });
    await prisma.bleTag.create({
      data: {
        mac: `C0:DE:00:00:00:${i.toString(16).padStart(2, '0').toUpperCase()}`, assetId: a.id,
        batteryV: 3.0 + Math.random() * 0.15, pvVoltage: 0.4 + Math.random() * 0.8, gatewayId: gws[(i - 1) % 4].id, lastSeen: new Date(),
      },
    });
  }

  // Inventory lots + trailers + rules
  for (const z of zones) {
    for (let k = 0; k < 2; k++)
      await prisma.inventoryLot.create({
        data: {
          warehouseId: demo, zoneId: z.id, commodity: 'potato', mt: Math.round(z.usedMT / 2),
          receivedAt: new Date(Date.now() - (30 + k * 40) * day), expiryAt: new Date(Date.now() + (150 - k * 40) * day),
        },
      });
  }
  const now = Date.now();
  const trailers = [
    ['Gujarat Roadways', 'GJ-08-AX-4412', 'potato', 28, 1, 'SCHEDULED'],
    ['Banas Transport', 'GJ-08-BT-1190', 'potato', 24, 2, 'SCHEDULED'],
    ['Shree Logistics', 'GJ-01-ZZ-7781', 'potato', 30, -0.5, 'ARRIVED'],
    ['Deesa Carriers', 'GJ-08-DC-0034', 'potato', 26, -1.5, 'UNLOADING'],
    ['Mehta Freight', 'GJ-02-QQ-5520', 'potato', 22, 4, 'SCHEDULED'],
    ['Patel Roadlines', 'GJ-08-PR-9021', 'potato', 27, -3, 'COMPLETED'],
  ] as const;
  for (const [carrier, plate, commodity, mt, hrs, status] of trailers)
    await prisma.inboundTrailer.create({
      data: {
        warehouseId: demo, carrier, plate, commodity, expectedMT: mt, status, scheduledAt: new Date(now + hrs * 3_600_000),
        arrivedAt: status === 'SCHEDULED' ? null : new Date(now + hrs * 3_600_000),
        doorNo: status === 'UNLOADING' || status === 'COMPLETED' ? 3 : null,
      },
    });
  await prisma.pickRule.createMany({
    data: [
      { warehouseId: demo, name: 'Potato — first-expiry-first-out', strategy: 'FEFO', priority: 10, commodity: 'potato' },
      { warehouseId: demo, name: 'Default — oldest first', strategy: 'FIFO', priority: 100 },
    ],
  });

  console.log(`Done: ${warehouses.length} warehouses, demo site = CWC Deesa (${demo}).`);
  console.log('Dev logins (password demo1234): admin@cwc.local, manager@cwc.local, partner@banas.local, auditor@cwc.local');
}

main().finally(() => prisma.$disconnect());
