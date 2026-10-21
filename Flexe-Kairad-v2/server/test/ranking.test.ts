import { describe, expect, it } from 'vitest';
import { rankCapacity, type Candidate } from '../src/services/rankingService.js';
import { routeLot, type Facility } from '../src/services/routingService.js';

const start = new Date('2026-12-01');
const end = new Date('2027-01-01'); // 31 days

const base: Candidate = {
  slotId: 's', warehouseId: 'w', warehouseName: 'W', providerId: 'p', providerName: 'P',
  tier: 'TRUSTED', rating: 4, onTimeRate: 0.9, commodities: ['potato'], coldStorage: true,
  palletsAvailable: 500, pricePerPalletDay: 10, handlingPerPallet: 0, readyHours: 24, distanceKm: 0,
  windowStart: new Date('2026-11-01'), windowEnd: new Date('2027-03-01'),
};
const mk = (o: Partial<Candidate>): Candidate => ({ ...base, ...o });
const req = { pallets: 100, start, end, commodity: 'potato' };

describe('rankCapacity', () => {
  it('computes total cost = storage + handling + haulage (hand-checked)', () => {
    const [r] = rankCapacity([mk({ slotId: 'a', handlingPerPallet: 5, distanceKm: 100 })], req).ranked;
    // 100*31*10 = 31000 ; handling 100*5 = 500 ; haulage 100 pallets*1MT*100km*3.5 = 35000
    expect(r.totalCost).toBe(31000 + 500 + 35000);
  });

  it('prefers the cheaper candidate when all else is equal', () => {
    const { ranked } = rankCapacity([mk({ slotId: 'dear', pricePerPalletDay: 14 }), mk({ slotId: 'cheap', pricePerPalletDay: 9 })], req);
    expect(ranked.map((r) => r.candidate.slotId)).toEqual(['cheap', 'dear']);
  });

  it('prefers shorter lead time when cost is equal', () => {
    const { ranked } = rankCapacity([mk({ slotId: 'slow', readyHours: 72 }), mk({ slotId: 'fast', readyHours: 6 })], req);
    expect(ranked[0].candidate.slotId).toBe('fast');
  });

  it('lets weights flip the winner', () => {
    const cands = [mk({ slotId: 'cheapSlow', pricePerPalletDay: 8, readyHours: 96 }), mk({ slotId: 'dearFast', pricePerPalletDay: 12, readyHours: 4 })];
    expect(rankCapacity(cands, { ...req, weights: { cost: 1, lead: 0, reliability: 0, fit: 0 } }).ranked[0].candidate.slotId).toBe('cheapSlow');
    expect(rankCapacity(cands, { ...req, weights: { cost: 0, lead: 1, reliability: 0, fit: 0 } }).ranked[0].candidate.slotId).toBe('dearFast');
  });

  it('survives a degenerate range (single candidate / identical candidates)', () => {
    const { ranked } = rankCapacity([mk({ slotId: 'a' }), mk({ slotId: 'b' })], req);
    expect(ranked).toHaveLength(2);
    ranked.forEach((r) => expect(Number.isFinite(r.score)).toBe(true));
  });

  it('applies hard filters with reasons', () => {
    const { ranked, rejected } = rankCapacity(
      [
        mk({ slotId: 'ok' }),
        mk({ slotId: 'window', windowEnd: new Date('2026-12-15') }),
        mk({ slotId: 'tier', tier: 'UNVERIFIED' }),
        mk({ slotId: 'crop', commodities: ['onion'] }),
      ],
      req,
    );
    expect(ranked.map((r) => r.candidate.slotId)).toEqual(['ok']);
    expect(rejected.map((r) => r.slotId).sort()).toEqual(['crop', 'tier', 'window']);
  });

  it('suggests a split when no single slot fits', () => {
    const res = rankCapacity([mk({ slotId: 'a', palletsAvailable: 60 }), mk({ slotId: 'b', palletsAvailable: 60, pricePerPalletDay: 12 })], req);
    expect(res.ranked).toHaveLength(0);
    expect(res.split?.covered).toBe(100);
    expect(res.split?.shortfall).toBe(0);
    expect(res.split?.lines.map((l) => [l.candidate.slotId, l.pallets])).toEqual([['a', 60], ['b', 40]]);
  });
});

const fac = (o: Partial<Facility>): Facility => ({
  id: 'f', name: 'F', kind: 'CWC', district: 'D', lat: 24.2, lng: 72.2, capacityMT: 10000, usedMT: 2000,
  tariffPerMTMonth: 300, commodities: ['potato'], coldStorage: true, ...o,
});

describe('routeLot', () => {
  const origin = { originLat: 24.26, originLng: 72.19, commodity: 'potato', quantityMT: 1000 };

  it('ranks the nearer, cheaper facility first', () => {
    const r = routeLot([fac({ id: 'far', lat: 22.3, lng: 73.2, tariffPerMTMonth: 320 }), fac({ id: 'near', lat: 24.0, lng: 72.4, tariffPerMTMonth: 290 })], origin);
    expect(r.ranked[0].facility.id).toBe('near');
    expect(r.overflow.recommended).toBe(false);
  });

  it('recommends overflow when nothing fits', () => {
    const r = routeLot([fac({ usedMT: 9800 })], origin);
    expect(r.overflow.recommended).toBe(true);
    expect(r.overflow.overflowMT).toBe(800);
    expect(r.allocation[0].mt).toBe(200);
  });

  it('recommends overflow when best fit would exceed the utilisation ceiling', () => {
    const r = routeLot([fac({ capacityMT: 10000, usedMT: 8500 })], origin); // 95% after
    expect(r.ranked).toHaveLength(1);
    expect(r.overflow.recommended).toBe(true);
    expect(r.overflow.overflowMT).toBe(0);
  });

  it('rejects facilities that cannot meet needBy', () => {
    const now = new Date('2026-12-01T00:00:00Z');
    const r = routeLot([fac({ id: 'a' })], { ...origin, now, needBy: new Date('2026-12-01T01:00:00Z') });
    expect(r.rejected[0].reason).toMatch(/needBy/);
  });
});
