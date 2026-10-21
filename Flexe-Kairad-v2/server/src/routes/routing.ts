import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, stateFilter } from '../lib/core.js';
import { routeLot } from '../services/routingService.js';

export async function routingRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };

  app.get('/production/heatmap', auth, async (req) => {
    const q = z.object({ commodity: z.string().default('potato'), season: z.string().optional() }).parse(req.query);
    const rows = await prisma.commodityProduction.findMany({
      where: { ...stateFilter, commodity: q.commodity, ...(q.season ? { season: q.season } : {}) },
      orderBy: { forecastMT: 'desc' },
    });
    return {
      type: 'FeatureCollection',
      features: rows.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.lng, r.lat] },
        properties: {
          district: r.district, commodity: r.commodity, season: r.season, forecastMT: r.forecastMT,
          harvestStart: r.harvestStart, harvestEnd: r.harvestEnd,
        },
      })),
    };
  });

  app.get('/warehouses', auth, async (req) => {
    const q = z.object({ kind: z.string().optional(), commodity: z.string().optional() }).parse(req.query);
    const rows = await prisma.warehouse.findMany({
      where: {
        ...stateFilter,
        active: true,
        ...(q.kind ? { kind: q.kind as never } : {}),
        ...(q.commodity ? { commodities: { has: q.commodity } } : {}),
      },
      include: { provider: { select: { name: true, tier: true } } },
      orderBy: { name: 'asc' },
    });
    return rows.map((w) => ({ ...w, utilisation: w.capacityMT ? w.usedMT / w.capacityMT : 0 }));
  });

  app.get('/network/summary', auth, async (req) => {
    const q = z.object({ commodity: z.string().default('potato') }).parse(req.query);
    const wh = await prisma.warehouse.findMany({ where: { ...stateFilter, active: true } });
    const internal = wh.filter((w) => w.kind === 'CWC' || w.kind === 'SWC');
    const sum = (a: typeof wh, f: 'capacityMT' | 'usedMT') => a.reduce((s, w) => s + w[f], 0);
    const prod = await prisma.commodityProduction.aggregate({
      where: { ...stateFilter, commodity: q.commodity }, _sum: { forecastMT: true },
    });
    const slots = await prisma.capacitySlot.aggregate({
      where: { status: { in: ['OPEN', 'PARTIAL'] }, endDate: { gte: new Date() }, warehouse: stateFilter },
      _sum: { pallets: true, palletsBooked: true },
    });
    const openBookings = await prisma.booking.count({ where: { status: { in: ['HELD', 'CONFIRMED'] } } });
    const critical = await prisma.alert.count({ where: { severity: 'CRITICAL', ackAt: null, warehouse: stateFilter } });
    const internalFree = sum(internal, 'capacityMT') - sum(internal, 'usedMT');
    return {
      warehouses: wh.length,
      internalCapacityMT: sum(internal, 'capacityMT'),
      internalUsedMT: sum(internal, 'usedMT'),
      internalUtilisation: sum(internal, 'capacityMT') ? sum(internal, 'usedMT') / sum(internal, 'capacityMT') : 0,
      forecastProductionMT: prod._sum.forecastMT ?? 0,
      // Crude surge signal: how much of the harvest would need storage vs. free internal space.
      // Assumes ~35% of a potato harvest goes to cold storage; tune per commodity.
      surgeDemandMT: Math.max(0, (prod._sum.forecastMT ?? 0) * 0.35 - internalFree),
      flexPalletsOpen: (slots._sum.pallets ?? 0) - (slots._sum.palletsBooked ?? 0),
      openBookings,
      criticalAlerts: critical,
    };
  });

  const recommendBody = z.object({
    originLat: z.number(), originLng: z.number(), commodity: z.string(),
    quantityMT: z.number().positive(), needBy: z.string().datetime().optional(),
    storageMonths: z.number().positive().optional(), needCold: z.boolean().optional(),
    weights: z.object({ proximity: z.number(), lead: z.number(), capacity: z.number(), tariff: z.number() }).partial().optional(),
  });

  app.post('/routing/recommend', auth, async (req) => {
    const b = recommendBody.parse(req.body);
    const wh = await prisma.warehouse.findMany({
      where: { ...stateFilter, active: true, kind: { in: ['CWC', 'SWC'] } },
    });
    const result = routeLot(
      wh.map((w) => ({ ...w, kind: w.kind as string })),
      { ...b, needBy: b.needBy ? new Date(b.needBy) : undefined },
    );
    await prisma.routingRecommendation.create({ data: { input: b, result: JSON.parse(JSON.stringify(result)) } });
    return result;
  });
}
