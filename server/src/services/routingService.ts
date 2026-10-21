import { normalizeLow, roadKm } from '../lib/geo.js';

/**
 * Internal-first routing: score CWC/SWC facilities for a lot of produce, and report
 * whether the lot should overflow to the 3PL marketplace.
 *
 * Score = wProx·proximity + wLead·leadTime + wCap·capacityHeadroom + wTariff·tariff
 * All four terms are min-max normalised across the facilities that pass the hard filters.
 */

export interface Facility {
  id: string;
  name: string;
  kind: string;
  district: string;
  lat: number;
  lng: number;
  capacityMT: number;
  usedMT: number;
  tariffPerMTMonth: number;
  commodities: string[];
  coldStorage: boolean;
  prepHours?: number; // time to be ready to receive (default 12)
}

export interface RouteRequest {
  originLat: number;
  originLng: number;
  commodity: string;
  quantityMT: number;
  needBy?: Date;
  now?: Date;
  storageMonths?: number;
  needCold?: boolean;
  weights?: Partial<RouteWeights>;
  /** utilisation above which we recommend overflow even if something still fits */
  overflowUtilisation?: number;
  avgSpeedKmph?: number;
}

export interface RouteWeights {
  proximity: number;
  lead: number;
  capacity: number;
  tariff: number;
}
export const DEFAULT_ROUTE_WEIGHTS: RouteWeights = { proximity: 0.3, lead: 0.25, capacity: 0.2, tariff: 0.25 };

export interface RoutedFacility {
  facility: Facility;
  distanceKm: number;
  leadHours: number;
  freeMT: number;
  utilisationAfter: number;
  storageCost: number;
  score: number;
  breakdown: { proximity: number; lead: number; capacity: number; tariff: number; weights: RouteWeights };
}

export interface RouteResult {
  ranked: RoutedFacility[];
  rejected: { facilityId: string; reason: string }[];
  /** Greedy allocation across ranked facilities when no single one has room. */
  allocation: { facilityId: string; name: string; mt: number }[];
  unallocatedMT: number;
  overflow: { recommended: boolean; reason: string; overflowMT: number };
}

export function routeLot(facilities: Facility[], req: RouteRequest): RouteResult {
  const now = req.now ?? new Date();
  const months = req.storageMonths ?? 3;
  const speed = req.avgSpeedKmph ?? 35;
  const overflowAt = req.overflowUtilisation ?? 0.9;
  const w: RouteWeights = { ...DEFAULT_ROUTE_WEIGHTS, ...req.weights };
  const wSum = w.proximity + w.lead + w.capacity + w.tariff || 1;

  const rejected: RouteResult['rejected'] = [];
  const pool: { f: Facility; km: number; lead: number; free: number }[] = [];

  for (const f of facilities) {
    const km = roadKm(req.originLat, req.originLng, f.lat, f.lng);
    const lead = (f.prepHours ?? 12) + km / speed;
    const free = f.capacityMT - f.usedMT;
    if (!f.commodities.includes(req.commodity)) rejected.push({ facilityId: f.id, reason: `does not handle ${req.commodity}` });
    else if (req.needCold && !f.coldStorage) rejected.push({ facilityId: f.id, reason: 'no cold storage' });
    else if (req.needBy && now.getTime() + lead * 3_600_000 > req.needBy.getTime())
      rejected.push({ facilityId: f.id, reason: 'cannot be reached/ready before needBy' });
    else if (free <= 0) rejected.push({ facilityId: f.id, reason: 'no free capacity' });
    else pool.push({ f, km, lead, free });
  }

  // A facility is a "full fit" only if it can hold the whole lot; partial ones feed the allocation.
  const full = pool.filter((p) => p.free >= req.quantityMT);
  const scoredPool = full.length ? full : pool;

  const prox = normalizeLow(scoredPool.map((p) => p.km));
  const lead = normalizeLow(scoredPool.map((p) => p.lead));
  // Capacity headroom after placing the lot (more headroom = better buffer for further arrivals).
  const capRaw = scoredPool.map((p) => Math.max(0, p.free - req.quantityMT) / p.f.capacityMT);
  const cap = capRaw.length && Math.max(...capRaw) !== Math.min(...capRaw)
    ? capRaw.map((v) => (v - Math.min(...capRaw)) / (Math.max(...capRaw) - Math.min(...capRaw)))
    : capRaw.map(() => 1);
  const tariff = normalizeLow(scoredPool.map((p) => p.f.tariffPerMTMonth));

  const ranked: RoutedFacility[] = scoredPool.map((p, i) => ({
    facility: p.f,
    distanceKm: p.km,
    leadHours: p.lead,
    freeMT: p.free,
    utilisationAfter: (p.f.usedMT + Math.min(req.quantityMT, p.free)) / p.f.capacityMT,
    storageCost: Math.min(req.quantityMT, p.free) * p.f.tariffPerMTMonth * months,
    score:
      (w.proximity * prox[i] + w.lead * lead[i] + w.capacity * cap[i] + w.tariff * tariff[i]) / wSum,
    breakdown: { proximity: prox[i], lead: lead[i], capacity: cap[i], tariff: tariff[i], weights: w },
  }));
  ranked.sort((a, b) => b.score - a.score);

  // Greedy allocation down the ranked list (all pool members, best score first if split needed).
  let left = req.quantityMT;
  const allocation: RouteResult['allocation'] = [];
  const order = full.length ? ranked : [...ranked];
  for (const r of order) {
    if (left <= 0) break;
    const take = Math.min(left, r.freeMT);
    allocation.push({ facilityId: r.facility.id, name: r.facility.name, mt: take });
    left -= take;
  }

  const best = ranked[0];
  let overflow: RouteResult['overflow'];
  if (!ranked.length) {
    overflow = { recommended: true, reason: 'No compatible internal facility with free capacity', overflowMT: req.quantityMT };
  } else if (left > 0) {
    overflow = { recommended: true, reason: 'Internal network cannot absorb the full lot', overflowMT: left };
  } else if (best.utilisationAfter > overflowAt) {
    overflow = {
      recommended: true,
      reason: `Best facility would reach ${(best.utilisationAfter * 100).toFixed(0)}% utilisation (> ${(overflowAt * 100).toFixed(0)}%)`,
      overflowMT: 0,
    };
  } else {
    overflow = { recommended: false, reason: 'Internal capacity sufficient', overflowMT: 0 };
  }

  return { ranked, rejected, allocation, unallocatedMT: Math.max(0, left), overflow };
}
