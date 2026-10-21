import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, stateFilter } from '../lib/core.js';
import { roadKm } from '../lib/geo.js';
import { daysBetween, rankCapacity, type Candidate } from '../services/rankingService.js';

const slotInput = z.object({
  warehouseCode: z.string(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  pallets: z.coerce.number().int().positive(),
  pricePerPalletDay: z.coerce.number().positive(),
  handlingPerPallet: z.coerce.number().min(0).default(0),
  readyHours: z.coerce.number().int().min(0).default(24),
});
type SlotInput = z.infer<typeof slotInput>;

/** Minimal CSV parser (no quoted commas) — header row must match slotInput keys. */
function parseCsv(text: string): Record<string, string>[] {
  const [head, ...rows] = text.trim().split(/\r?\n/);
  const cols = head.split(',').map((c) => c.trim());
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split(',').map((v, i) => [cols[i], v.trim()])));
}

async function upsertSlots(items: SlotInput[], source: string, actor: { providerId?: string | null; role: string }) {
  const errors: { index: number; error: string }[] = [];
  let created = 0;
  for (const [i, it] of items.entries()) {
    const wh = await prisma.warehouse.findUnique({ where: { code: it.warehouseCode } });
    if (!wh) { errors.push({ index: i, error: `unknown warehouse ${it.warehouseCode}` }); continue; }
    if (!wh.kind.startsWith('PRIVATE')) { errors.push({ index: i, error: 'only private 3PL/2PL warehouses can publish flex capacity' }); continue; }
    if (actor.role === 'PARTNER_3PL' && wh.providerId !== actor.providerId) { errors.push({ index: i, error: 'not your warehouse' }); continue; }
    if (it.endDate <= it.startDate) { errors.push({ index: i, error: 'endDate must be after startDate' }); continue; }
    await prisma.capacitySlot.create({
      data: {
        warehouseId: wh.id, startDate: it.startDate, endDate: it.endDate, pallets: it.pallets,
        pricePerPalletDay: it.pricePerPalletDay, handlingPerPallet: it.handlingPerPallet,
        readyHours: it.readyHours, source,
      },
    });
    created++;
  }
  return { created, errors };
}

async function loadCandidates(origin: { lat: number; lng: number }, from: Date, to: Date): Promise<Candidate[]> {
  const slots = await prisma.capacitySlot.findMany({
    where: {
      status: { in: ['OPEN', 'PARTIAL'] },
      startDate: { lte: from },
      endDate: { gte: to },
      warehouse: { ...stateFilter, active: true },
    },
    include: { warehouse: { include: { provider: true } } },
  });
  return slots.map((s) => ({
    slotId: s.id,
    warehouseId: s.warehouseId,
    warehouseName: s.warehouse.name,
    providerId: s.warehouse.providerId,
    providerName: s.warehouse.provider?.name ?? 'Independent',
    tier: (s.warehouse.provider?.tier ?? 'UNVERIFIED') as Candidate['tier'],
    rating: s.warehouse.provider?.rating ?? 3,
    onTimeRate: s.warehouse.provider?.onTimeRate ?? 0.85,
    commodities: s.warehouse.commodities,
    coldStorage: s.warehouse.coldStorage,
    palletsAvailable: s.pallets - s.palletsBooked,
    pricePerPalletDay: s.pricePerPalletDay,
    handlingPerPallet: s.handlingPerPallet,
    readyHours: s.readyHours,
    distanceKm: roadKm(origin.lat, origin.lng, s.warehouse.lat, s.warehouse.lng),
    windowStart: s.startDate,
    windowEnd: s.endDate,
  }));
}

export async function capacityRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticate] };
  const partner = { preHandler: [app.authenticate, app.requireRole('CWC_ADMIN', 'REGIONAL_MGR', 'PARTNER_3PL')] };
  const buyer = { preHandler: [app.authenticate, app.requireRole('CWC_ADMIN', 'REGIONAL_MGR')] };

  // ── Provider onboarding ──
  app.get('/providers', auth, async () => prisma.provider.findMany({ include: { warehouses: { select: { code: true, name: true } } } }));

  app.post('/providers', { preHandler: [app.authenticate, app.requireRole('CWC_ADMIN')] }, async (req) => {
    const b = z.object({
      name: z.string().min(2), contactEmail: z.string().email().optional(),
      tier: z.enum(['UNVERIFIED', 'VERIFIED', 'TRUSTED']).default('UNVERIFIED'),
    }).parse(req.body);
    return prisma.provider.create({ data: { ...b, verifiedAt: b.tier === 'UNVERIFIED' ? null : new Date() } });
  });

  // ── Capacity ingest: JSON ──
  app.post('/capacity/ingest', partner, async (req) => {
    const b = z.object({ slots: z.array(slotInput).min(1).max(1000) }).parse(req.body);
    return upsertSlots(b.slots, 'API', req.user);
  });

  // ── Capacity ingest: CSV (text/csv body or multipart file) ──
  app.post('/capacity/ingest/csv', partner, async (req, reply) => {
    let text = '';
    if (req.isMultipart()) {
      const file = await req.file();
      text = file ? (await file.toBuffer()).toString('utf8') : '';
    } else {
      text = typeof req.body === 'string' ? req.body : '';
    }
    if (!text) return reply.code(400).send({ error: 'empty CSV' });
    const parsed: SlotInput[] = [];
    const errors: { index: number; error: string }[] = [];
    parseCsv(text).forEach((row, index) => {
      const r = slotInput.safeParse(row);
      if (r.success) parsed.push(r.data);
      else errors.push({ index, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
    });
    const res = await upsertSlots(parsed, 'CSV', req.user);
    return { created: res.created, errors: [...errors, ...res.errors] };
  });

  app.get('/capacity/search', auth, async (req) => {
    const q = z.object({ from: z.coerce.date(), to: z.coerce.date(), lat: z.coerce.number().default(23.0), lng: z.coerce.number().default(72.6) }).parse(req.query);
    return (await loadCandidates({ lat: q.lat, lng: q.lng }, q.from, q.to)).sort((a, b) => a.distanceKm - b.distanceKm);
  });

  // ── Ranking ──
  app.post('/capacity/rank', auth, async (req) => {
    const b = z.object({
      originLat: z.number(), originLng: z.number(), commodity: z.string(),
      pallets: z.number().int().positive(), start: z.coerce.date(), end: z.coerce.date(),
      needCold: z.boolean().optional(), minTier: z.enum(['UNVERIFIED', 'VERIFIED', 'TRUSTED']).optional(),
      weights: z.object({ cost: z.number(), lead: z.number(), reliability: z.number(), fit: z.number() }).partial().optional(),
    }).parse(req.body);
    const cands = await loadCandidates({ lat: b.originLat, lng: b.originLng }, b.start, b.end);
    return rankCapacity(cands, b);
  });

  // ── Bookings ──
  app.get('/bookings', auth, async (req) => {
    const where = req.user.role === 'PARTNER_3PL'
      ? { lines: { some: { slot: { warehouse: { providerId: req.user.providerId ?? '-' } } } } }
      : {};
    return prisma.booking.findMany({
      where, orderBy: { createdAt: 'desc' }, take: 100,
      include: { lines: { include: { slot: { include: { warehouse: { select: { name: true, code: true } } } } } } },
    });
  });

  /** Locks pallets atomically: re-reads each slot inside a transaction and refuses over-booking. */
  app.post('/bookings', buyer, async (req, reply) => {
    const b = z.object({
      commodity: z.string(), start: z.coerce.date(), end: z.coerce.date(), notes: z.string().optional(),
      lines: z.array(z.object({ slotId: z.string(), pallets: z.number().int().positive() })).min(1),
    }).parse(req.body);
    const days = daysBetween(b.start, b.end);

    try {
      const booking = await prisma.$transaction(async (tx) => {
        let total = 0;
        const lineData: { slotId: string; pallets: number; days: number; startDate: Date; cost: number }[] = [];
        for (const l of b.lines) {
          const slot = await tx.capacitySlot.findUnique({ where: { id: l.slotId } });
          if (!slot || slot.status === 'WITHDRAWN') throw new Error(`slot ${l.slotId} unavailable`);
          if (slot.startDate > b.start || slot.endDate < b.end) throw new Error(`slot ${l.slotId} does not cover the requested window`);
          // Conditional increment: succeeds only if capacity remains at write time.
          const upd = await tx.capacitySlot.updateMany({
            where: { id: slot.id, palletsBooked: { lte: slot.pallets - l.pallets } },
            data: { palletsBooked: { increment: l.pallets } },
          });
          if (upd.count !== 1) throw new Error(`slot ${l.slotId} no longer has ${l.pallets} pallets free`);
          const after = slot.palletsBooked + l.pallets;
          await tx.capacitySlot.update({ where: { id: slot.id }, data: { status: after >= slot.pallets ? 'FULL' : 'PARTIAL' } });
          const cost = l.pallets * days * slot.pricePerPalletDay + l.pallets * slot.handlingPerPallet;
          total += cost;
          lineData.push({ slotId: slot.id, pallets: l.pallets, days, startDate: b.start, cost });
        }
        return tx.booking.create({
          data: {
            ref: `BK-${Date.now().toString(36).toUpperCase()}`,
            requesterId: req.user.sub, commodity: b.commodity, notes: b.notes, totalCost: total,
            holdUntil: new Date(Date.now() + 24 * 3_600_000),
            lines: { create: lineData },
          },
          include: { lines: true },
        });
      });
      await prisma.auditLog.create({ data: { actorId: req.user.sub, action: 'booking.hold', entity: 'Booking', entityId: booking.id } });
      return reply.code(201).send(booking);
    } catch (e) {
      return reply.code(409).send({ error: (e as Error).message });
    }
  });

  app.patch('/bookings/:id/:action', partner, async (req, reply) => {
    const { id, action } = z.object({ id: z.string(), action: z.enum(['confirm', 'cancel']) }).parse(req.params);
    const bk = await prisma.booking.findUnique({ where: { id }, include: { lines: true } });
    if (!bk) return reply.code(404).send({ error: 'not found' });
    if (bk.status !== 'HELD' && !(action === 'cancel' && bk.status === 'CONFIRMED'))
      return reply.code(409).send({ error: `cannot ${action} a ${bk.status} booking` });

    if (action === 'confirm') {
      const u = await prisma.booking.update({ where: { id }, data: { status: 'CONFIRMED', holdUntil: null } });
      await prisma.auditLog.create({ data: { actorId: req.user.sub, action: 'booking.confirm', entity: 'Booking', entityId: id } });
      return u;
    }
    // cancel → release pallets
    await prisma.$transaction(async (tx) => {
      for (const l of bk.lines) {
        const s = await tx.capacitySlot.update({ where: { id: l.slotId }, data: { palletsBooked: { decrement: l.pallets } } });
        await tx.capacitySlot.update({ where: { id: s.id }, data: { status: s.palletsBooked <= 0 ? 'OPEN' : 'PARTIAL' } });
      }
      await tx.booking.update({ where: { id }, data: { status: 'CANCELLED' } });
    });
    await prisma.auditLog.create({ data: { actorId: req.user.sub, action: 'booking.cancel', entity: 'Booking', entityId: id } });
    return { ok: true };
  });
}
