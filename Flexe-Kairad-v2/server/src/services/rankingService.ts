import { normalizeHigh, normalizeLow } from '../lib/geo.js';

/**
 * 3PL capacity ranking.
 *
 *  1. Hard filters   — window coverage, pallets available, commodity/cold fit, trust tier.
 *  2. Normalisation  — cost and lead time are min-max scaled across the *surviving* candidates,
 *                      so scores are relative ("best available now"), not absolute.
 *  3. Weighted sum   — score = wCost·cost + wLead·lead + wReliab·reliability + wFit·fit
 *  4. Output         — ranked list with the per-term breakdown, so a manager can see *why*.
 */

export type Tier = 'UNVERIFIED' | 'VERIFIED' | 'TRUSTED';
const TIER_RANK: Record<Tier, number> = { UNVERIFIED: 0, VERIFIED: 1, TRUSTED: 2 };

export interface Candidate {
  slotId: string;
  warehouseId: string;
  warehouseName: string;
  providerId: string | null;
  providerName: string;
  tier: Tier;
  rating: number; // 0–5
  onTimeRate: number; // 0–1
  commodities: string[];
  coldStorage: boolean;
  palletsAvailable: number;
  pricePerPalletDay: number;
  handlingPerPallet: number;
  readyHours: number;
  distanceKm: number; // road km from the request origin to the warehouse
  windowStart: Date;
  windowEnd: Date;
}

export interface RankRequest {
  pallets: number;
  start: Date;
  end: Date;
  commodity: string;
  needCold?: boolean;
  minTier?: Tier;
  weights?: Partial<Weights>;
  /** tonnes per pallet — used for the transport cost estimate */
  mtPerPallet?: number;
  /** INR per tonne-km for inbound haulage */
  transportRatePerMTKm?: number;
  avgSpeedKmph?: number;
}

export interface Weights {
  cost: number;
  lead: number;
  reliability: number;
  fit: number;
}

export const DEFAULT_WEIGHTS: Weights = { cost: 0.4, lead: 0.3, reliability: 0.2, fit: 0.1 };

export interface RankedCandidate {
  candidate: Candidate;
  days: number;
  totalCost: number; // INR: storage + handling + inbound transport
  leadHours: number;
  score: number;
  breakdown: {
    cost: number;
    lead: number;
    reliability: number;
    fit: number;
    weights: Weights;
  };
}

export interface SplitSuggestion {
  covered: number;
  shortfall: number;
  lines: { candidate: Candidate; pallets: number; cost: number }[];
  totalCost: number;
}

export interface RankResult {
  ranked: RankedCandidate[];
  rejected: { slotId: string; reason: string }[];
  /** Present only when no single slot can hold the full request. */
  split?: SplitSuggestion;
}

const DAY_MS = 86_400_000;
export const daysBetween = (start: Date, end: Date) =>
  Math.max(1, Math.ceil((end.getTime() - start.getTime()) / DAY_MS));

export function normalizeWeights(w: Weights): Weights {
  const sum = w.cost + w.lead + w.reliability + w.fit;
  if (sum <= 0) return DEFAULT_WEIGHTS;
  return { cost: w.cost / sum, lead: w.lead / sum, reliability: w.reliability / sum, fit: w.fit / sum };
}

function rejectReason(c: Candidate, r: RankRequest): string | null {
  if (c.windowStart > r.start || c.windowEnd < r.end) return 'window does not cover requested dates';
  if (!c.commodities.includes(r.commodity)) return `does not handle ${r.commodity}`;
  if (r.needCold && !c.coldStorage) return 'no cold storage';
  if (TIER_RANK[c.tier] < TIER_RANK[r.minTier ?? 'VERIFIED']) return `provider tier ${c.tier} below minimum`;
  return null;
}

export function rankCapacity(candidates: Candidate[], req: RankRequest): RankResult {
  const days = daysBetween(req.start, req.end);
  const mtPerPallet = req.mtPerPallet ?? 1;
  const haul = req.transportRatePerMTKm ?? 3.5;
  const speed = req.avgSpeedKmph ?? 35;
  const weights = normalizeWeights({ ...DEFAULT_WEIGHTS, ...req.weights });

  const rejected: RankResult['rejected'] = [];
  const eligible: Candidate[] = [];
  for (const c of candidates) {
    const why = rejectReason(c, req);
    if (why) rejected.push({ slotId: c.slotId, reason: why });
    else eligible.push(c);
  }

  const costOf = (c: Candidate, pallets: number) =>
    pallets * days * c.pricePerPalletDay +
    pallets * c.handlingPerPallet +
    pallets * mtPerPallet * c.distanceKm * haul;

  // Single-slot candidates only for the ranked list.
  const single = eligible.filter((c) => c.palletsAvailable >= req.pallets);
  for (const c of eligible) {
    if (c.palletsAvailable < req.pallets) rejected.push({ slotId: c.slotId, reason: 'insufficient pallets in a single slot' });
  }

  const ranked: RankedCandidate[] = [];
  if (single.length) {
    const costs = single.map((c) => costOf(c, req.pallets));
    const leads = single.map((c) => c.readyHours + c.distanceKm / speed);
    const costS = normalizeLow(costs);
    const leadS = normalizeLow(leads);
    const reliab = single.map((c) => 0.6 * (c.rating / 5) + 0.4 * c.onTimeRate);
    // Fit: prefer slots that are filled well (less stranded capacity / fragmentation).
    const fit = normalizeHigh(single.map((c) => req.pallets / c.palletsAvailable));

    single.forEach((c, i) => {
      const score =
        weights.cost * costS[i] + weights.lead * leadS[i] + weights.reliability * reliab[i] + weights.fit * fit[i];
      ranked.push({
        candidate: c,
        days,
        totalCost: costs[i],
        leadHours: leads[i],
        score,
        breakdown: { cost: costS[i], lead: leadS[i], reliability: reliab[i], fit: fit[i], weights },
      });
    });
    ranked.sort((a, b) => b.score - a.score || a.totalCost - b.totalCost);
  }

  let split: SplitSuggestion | undefined;
  if (!ranked.length && eligible.length) {
    // Greedy fill by cheapest unit cost until the request is covered.
    const byUnit = [...eligible].sort((a, b) => costOf(a, 1) - costOf(b, 1));
    let left = req.pallets;
    const lines: SplitSuggestion['lines'] = [];
    for (const c of byUnit) {
      if (left <= 0) break;
      const take = Math.min(left, c.palletsAvailable);
      lines.push({ candidate: c, pallets: take, cost: costOf(c, take) });
      left -= take;
    }
    split = {
      covered: req.pallets - left,
      shortfall: Math.max(0, left),
      lines,
      totalCost: lines.reduce((s, l) => s + l.cost, 0),
    };
  }

  return { ranked, rejected, split };
}
