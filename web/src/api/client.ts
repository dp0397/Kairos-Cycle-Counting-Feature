import { useQuery } from '@tanstack/react-query';

const BASE = '/api/v1';
export const getToken = () => localStorage.getItem('cwc_token');
export const setToken = (t: string | null) => (t ? localStorage.setItem('cwc_token', t) : localStorage.removeItem('cwc_token'));

export async function api<T>(path: string, opts: { method?: string; body?: unknown; raw?: BodyInit; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: opts.method ?? (opts.body || opts.raw ? 'POST' : 'GET'),
    headers: { ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(getToken() ? { authorization: `Bearer ${getToken()}` } : {}), ...opts.headers },
    body: opts.raw ?? (opts.body ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && path !== '/auth/login') { setToken(null); location.reload(); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const useGet = <T,>(key: unknown[], path: string, opts?: { refetchInterval?: number; enabled?: boolean }) =>
  useQuery({ queryKey: key, queryFn: () => api<T>(path), ...opts });

/* ───── shared types ───── */
export interface Warehouse {
  id: string; code: string; name: string; kind: 'CWC' | 'SWC' | 'PRIVATE_3PL' | 'PRIVATE_2PL'; district: string;
  lat: number; lng: number; capacityMT: number; usedMT: number; utilisation: number; tariffPerMTMonth: number;
  coldStorage: boolean; commodities: string[];
}
export interface RoutedFacility {
  facility: Warehouse; distanceKm: number; leadHours: number; freeMT: number; utilisationAfter: number; storageCost: number; score: number;
  breakdown: { proximity: number; lead: number; capacity: number; tariff: number };
}
export interface RouteResult {
  ranked: RoutedFacility[]; allocation: { facilityId: string; name: string; mt: number }[]; unallocatedMT: number;
  overflow: { recommended: boolean; reason: string; overflowMT: number };
}
export interface RankedCandidate {
  candidate: { slotId: string; warehouseName: string; providerName: string; tier: string; palletsAvailable: number; pricePerPalletDay: number; distanceKm: number; readyHours: number };
  days: number; totalCost: number; leadHours: number; score: number;
  breakdown: { cost: number; lead: number; reliability: number; fit: number };
}
export interface RankResult {
  ranked: RankedCandidate[]; rejected: { slotId: string; reason: string }[];
  split?: { covered: number; shortfall: number; totalCost: number; lines: { candidate: RankedCandidate['candidate']; pallets: number; cost: number }[] };
}

export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
export const mt = (n: number) => Math.round(n).toLocaleString('en-IN') + ' MT';
export const pct = (n: number) => (n * 100).toFixed(0) + '%';
