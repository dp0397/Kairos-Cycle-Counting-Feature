import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/* ───── types ───── */
export const UOMS = ['Eaches', 'Pallets', 'Cartons', 'Sacks'] as const;
export type Uom = (typeof UOMS)[number];
export const WAREHOUSES = ['CWC Deesa', 'CWC Ahmedabad', 'CWC Palanpur', 'Sanand Distribution Centre'];
export const OPERATIVES = ['Ravi Patel', 'Meena Shah', 'Imran Qureshi', 'Kiran Joshi'];

export interface Item {
  id: string; sku: string; description: string; quantity: number; uom: Uom; warehouse: string; location: string; skuCode?: string; weeklyDemand?: number;
  /** v2 pack + stacking data. Mandatory for anything added through master data; older seed rows may lack it. */
  storageType?: 'PALLET' | 'BIN'; ti?: number; hi?: number; unitsPerPack?: number; isStackable?: boolean; maxStackUnits?: number;
  oem?: string; manufacturer?: string;
  /** Client columns with no typed home, kept as received. */
  custom?: Record<string, string | number | boolean>;
}
/** True when a SKU still lacks the mandatory pack / stacking data. */
export const needsPackData = (i: Item) => !i.storageType || !i.unitsPerPack || i.isStackable === undefined || (i.isStackable && !i.maxStackUnits);
export type CountMethod = 'HANDHELD' | 'CSV' | 'MANUAL';
/** Every scan/upload is logged with a timestamp: the raw material for labour standards, walk paths and slotting later. */
export interface ScanEvent { t: string; kind: 'LOCATION' | 'SKU' | 'ERROR' | 'CSV' | 'CLOSE'; code: string; loc?: string; sku?: string; qty?: number; note?: string }
export type Stage = 1 | 2 | 3 | 4 | 5;
export const STAGES = ['Cycle count requested', 'In progress', 'Counted · awaiting tally', 'Awaiting approval', 'Completed'] as const;
export interface CountLine { itemId: string; sku: string; warehouse: string; location: string; uom: Uom; expected: number; counted: number | null; recount?: boolean; extra?: boolean; countedAt?: string }
export interface CountJob {
  id: string; type: 'LOCATION' | 'SKU'; targets: string[]; operative: string; priority: 'Normal' | 'High';
  requestedAt: string; stage: Stage; lines: CountLine[]; note?: string; approvedBy?: string; completedAt?: string; rejectedNote?: string;
  method?: CountMethod; scans: ScanEvent[]; startedAt?: string; finishedAt?: string;
}
export interface HistoryEntry { id: string; countId: string; date: string; sku: string; warehouse: string; location: string; uom: Uom; expected: number; counted: number; adjusted: boolean; approvedBy: string; method?: CountMethod }
interface State { items: Item[]; jobs: CountJob[]; history: HistoryEntry[] }

export const locKey = (warehouse: string, location: string) => `${warehouse}|${location}`;
export const locLabel = (k: string) => k.replace('|', ' · ');

/* ───── tags, walk route, velocity ───── */
const WH_CODE: Record<string, string> = { 'CWC Deesa': 'DEE', 'CWC Ahmedabad': 'AMD', 'CWC Palanpur': 'PLN', 'Sanand Distribution Centre': 'SND' };
export const whCode = (w: string) => WH_CODE[w] ?? (w.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'WH');
/** What is printed on the rack-location label the Zebra scans. */
export const locTag = (warehouse: string, location: string) => `${whCode(warehouse)}-${location}`;
const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h % 1_000_000; };
/** The SKU tag/barcode: the code captured in master data, or a stable generated one when none was entered. */
export const skuTagOf = (items: Item[], sku: string) => items.find((i) => i.sku === sku && i.skuCode)?.skuCode ?? `SKU${String(hash(sku.toLowerCase())).padStart(6, '0')}`;
/** Walk order through a warehouse: the sequence the operative should follow (and, later, the basis of pick-path sequencing). */
export const routeCompare = (a: { warehouse: string; location: string }, b: { warehouse: string; location: string }) => a.warehouse.localeCompare(b.warehouse) || a.location.localeCompare(b.location, undefined, { numeric: true });

export type Velocity = 'A' | 'B' | 'C';
export const DUE_DAYS: Record<Velocity, number> = { A: 7, B: 14, C: 30 };
/** ABC class from weekly demand: A = the SKUs making up the first 80% of volume, B = next 15%, C = the tail. */
export function velocityMap(items: Item[]): Map<string, Velocity> {
  const d = new Map<string, number>(); items.forEach((i) => d.set(i.sku, Math.max(d.get(i.sku) ?? 0, i.weeklyDemand ?? 0)));
  const sorted = [...d.entries()].sort((a, b) => b[1] - a[1]); const total = sorted.reduce((s, [, v]) => s + v, 0) || 1;
  const out = new Map<string, Velocity>(); let cum = 0;
  for (const [sku, v] of sorted) { out.set(sku, v === 0 ? 'C' : cum / total < 0.8 ? 'A' : cum / total < 0.95 ? 'B' : 'C'); cum += v; }
  return out;
}
const DEMAND: Record<string, number> = { 'Basmati Rice 25kg': 900, 'Wheat Flour 50kg': 1300, 'Table Potato 50kg': 2000, 'Cumin Seeds 40kg': 150, 'Cattle Feed Pellets 30kg': 400, 'Groundnut Oil 15L': 260, 'Corrugated Box 5-ply': 3000, 'Pallet Wrap 500mm': 90, 'Packaged Potato Chips': 700, 'Instant Noodles 12-pack': 850, 'Mustard Oil 5L': 200, 'Mixed Grocery Pallet': 40, 'Cold-Chain Crate 40L': 300, 'Castor Seed 50kg': 500, 'Fennel Seeds 25kg': 100, 'Empty Export Pallet': 60 };

/* ───── seed data (deterministic, illustrative) ───── */
function rng(seed: number) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const RAW: [string, string, number, Uom, string, string][] = [
  ['Basmati Rice 25kg', 'Premium long-grain basmati, 25kg bag', 1840, 'Sacks', 'CWC Deesa', 'A-01-01'],
  ['Wheat Flour 50kg', 'Milled atta, 50kg bag', 2200, 'Sacks', 'CWC Deesa', 'A-01-02'],
  ['Table Potato 50kg', 'Grade A cold-stored potato, 50kg mesh sack', 3600, 'Sacks', 'CWC Deesa', 'B-02-01'],
  ['Cumin Seeds 40kg', 'Cleaned jeera, 40kg bag', 420, 'Sacks', 'CWC Deesa', 'B-02-02'],
  ['Cattle Feed Pellets 30kg', 'Compound feed, 30kg bag', 960, 'Sacks', 'CWC Deesa', 'C-03-01'],
  ['Groundnut Oil 15L', 'Refined groundnut oil tin, 15L', 310, 'Cartons', 'CWC Deesa', 'C-03-02'],
  ['Corrugated Box 5-ply', 'Master carton, 5-ply', 5400, 'Eaches', 'CWC Deesa', 'D-04-01'],
  ['Pallet Wrap 500mm', 'Stretch film roll', 260, 'Eaches', 'CWC Deesa', 'D-04-02'],
  ['Basmati Rice 25kg', 'Premium long-grain basmati, 25kg bag', 1200, 'Sacks', 'CWC Ahmedabad', 'A-02-01'],
  ['Wheat Flour 50kg', 'Milled atta, 50kg bag', 1500, 'Sacks', 'CWC Ahmedabad', 'A-02-02'],
  ['Packaged Potato Chips', 'Retail chips, 24 x 50g', 780, 'Cartons', 'CWC Ahmedabad', 'B-01-01'],
  ['Instant Noodles 12-pack', 'Masala noodles, 12 x 70g', 1150, 'Cartons', 'CWC Ahmedabad', 'B-01-02'],
  ['Mustard Oil 5L', 'Kachi ghani mustard oil, 5L', 640, 'Cartons', 'CWC Ahmedabad', 'B-01-03'],
  ['Mixed Grocery Pallet', 'Mixed FMCG pallet, build to order', 48, 'Pallets', 'CWC Ahmedabad', 'P-01-01'],
  ['Cold-Chain Crate 40L', 'Reusable HDPE crate', 2400, 'Eaches', 'CWC Ahmedabad', 'D-03-01'],
  ['Table Potato 50kg', 'Grade A cold-stored potato, 50kg mesh sack', 2900, 'Sacks', 'CWC Palanpur', 'A-01-01'],
  ['Castor Seed 50kg', 'Raw castor seed, 50kg bag', 1320, 'Sacks', 'CWC Palanpur', 'A-01-02'],
  ['Cumin Seeds 40kg', 'Cleaned jeera, 40kg bag', 610, 'Sacks', 'CWC Palanpur', 'A-02-01'],
  ['Fennel Seeds 25kg', 'Saunf, 25kg bag', 380, 'Sacks', 'CWC Palanpur', 'A-02-02'],
  ['Empty Export Pallet', 'ISPM-15 timber pallet', 120, 'Pallets', 'CWC Palanpur', 'P-02-01'],
  ['Groundnut Oil 15L', 'Refined groundnut oil tin, 15L', 450, 'Cartons', 'Sanand Distribution Centre', 'R-10-01'],
  ['Packaged Potato Chips', 'Retail chips, 24 x 50g', 1320, 'Cartons', 'Sanand Distribution Centre', 'R-10-02'],
  ['Instant Noodles 12-pack', 'Masala noodles, 12 x 70g', 980, 'Cartons', 'Sanand Distribution Centre', 'R-11-01'],
  ['Mixed Grocery Pallet', 'Mixed FMCG pallet, build to order', 72, 'Pallets', 'Sanand Distribution Centre', 'P-05-01'],
  ['Corrugated Box 5-ply', 'Master carton, 5-ply', 8200, 'Eaches', 'Sanand Distribution Centre', 'D-12-01'],
  ['Pallet Wrap 500mm', 'Stretch film roll', 410, 'Eaches', 'Sanand Distribution Centre', 'D-12-02'],
];

function seed(): State {
  const items: Item[] = RAW.map(([sku, description, quantity, uom, warehouse, location], i) => ({ id: `it${i + 1}`, sku, description, quantity, uom, warehouse, location, weeklyDemand: DEMAND[sku] }));
  const r = rng(42);
  const history: HistoryEntry[] = [];
  const jobs: CountJob[] = [];
  const approvers = ['A. Mehta', 'S. Desai'];
  for (let k = 0; k < 6; k++) {
    const date = daysAgo(28 - k * 5);
    const id = `CC-${1032 + k}`;
    const lines: CountLine[] = [];
    for (let j = 0; j < 8; j++) {
      const it = items[(k * 5 + j) % items.length];
      let diff = 0;
      if (r() > 0.68) { diff = Math.max(1, Math.round(it.quantity * (0.01 + r() * 0.04))) * (r() > 0.5 ? 1 : -1); }
      const counted = it.quantity + diff;
      lines.push({ itemId: it.id, sku: it.sku, warehouse: it.warehouse, location: it.location, uom: it.uom, expected: it.quantity, counted });
      history.push({ id: `${id}-${j}`, countId: id, date, sku: it.sku, warehouse: it.warehouse, location: it.location, uom: it.uom, expected: it.quantity, counted, adjusted: diff !== 0, approvedBy: approvers[k % 2], method: k % 2 ? 'CSV' : 'HANDHELD' });
    }
    const byLoc = k % 2 === 0;
    jobs.push({ id, type: byLoc ? 'LOCATION' : 'SKU', targets: byLoc ? [...new Set(lines.map((l) => locKey(l.warehouse, l.location)))] : [...new Set(lines.map((l) => l.sku))], operative: OPERATIVES[k % 4], priority: 'Normal', requestedAt: date, stage: 5, lines, approvedBy: approvers[k % 2], completedAt: date, method: k % 2 ? 'CSV' : 'HANDHELD', scans: [] });
  }
  const mk = (id: string, type: 'LOCATION' | 'SKU', targets: string[], stage: Stage, op: string, pri: 'Normal' | 'High', ago: number, counted: (n: number, i: number) => number | null): CountJob => {
    const sel = items.filter((it) => (type === 'LOCATION' ? targets.includes(locKey(it.warehouse, it.location)) : targets.includes(it.sku)));
    return { id, type, targets, operative: op, priority: pri, requestedAt: daysAgo(ago), stage, scans: [], lines: sel.map((it, i) => ({ itemId: it.id, sku: it.sku, warehouse: it.warehouse, location: it.location, uom: it.uom, expected: it.quantity, counted: counted(it.quantity, i) })) };
  };
  jobs.push(
    mk('CC-1038', 'SKU', ['Cumin Seeds 40kg'], 4, 'Meena Shah', 'Normal', 3, (q, i) => (i === 0 ? q - 6 : q)),
    mk('CC-1039', 'LOCATION', [locKey('CWC Palanpur', 'A-01-01'), locKey('CWC Palanpur', 'A-01-02')], 3, 'Imran Qureshi', 'Normal', 2, (q, i) => (i === 1 ? q + 12 : q)),
    mk('CC-1040', 'SKU', ['Basmati Rice 25kg'], 2, 'Ravi Patel', 'High', 1, (q, i) => (i === 0 ? q : null)),
    mk('CC-1041', 'LOCATION', [locKey('Sanand Distribution Centre', 'R-10-01'), locKey('Sanand Distribution Centre', 'R-10-02')], 1, 'Kiran Joshi', 'High', 0, () => null),
  );
  return { items, jobs, history };
}

/* ───── KPIs ───── */
export interface Accuracy { qty: number | null; sku: number | null; loc: number | null; lines: number }
/** Accuracy over the latest count of each sku/location line, so the numbers move as soon as an approval lands. */
export function accuracy(entries: HistoryEntry[]): Accuracy {
  const latest = new Map<string, HistoryEntry>();
  for (const e of entries) { const k = `${e.sku}|${e.warehouse}|${e.location}`; const p = latest.get(k); if (!p || p.date <= e.date) latest.set(k, e); }
  const L = [...latest.values()];
  if (!L.length) return { qty: null, sku: null, loc: null, lines: 0 };
  const ratio = (key: (e: HistoryEntry) => string) => { const m = new Map<string, boolean>(); for (const e of L) m.set(key(e), (m.get(key(e)) ?? true) && e.counted === e.expected); return [...m.values()].filter(Boolean).length / m.size; };
  const qty = L.reduce((s, e) => s + (e.expected ? Math.max(0, 1 - Math.abs(e.counted - e.expected) / e.expected) : 1), 0) / L.length;
  return { qty, sku: ratio((e) => e.sku), loc: ratio((e) => locKey(e.warehouse, e.location)), lines: L.length };
}

/* ───── context ───── */
interface Ctx extends State {
  addOrUpdate: (rows: Omit<Item, 'id'>[]) => { added: number; updated: number };
  updateItem: (id: string, patch: Partial<Omit<Item, 'id'>>) => void;
  removeItem: (id: string) => void;
  requestCount: (p: { type: 'LOCATION' | 'SKU'; targets: string[]; operative: string; priority: 'Normal' | 'High'; note?: string }) => string;
  startCount: (id: string) => void;
  updateJob: (id: string, fn: (j: CountJob) => CountJob) => void;
  setCounted: (id: string, itemId: string, v: number | null) => void;
  finishCount: (id: string) => void;
  recountLine: (id: string, itemId: string) => void;
  sendForApproval: (id: string) => void;
  approve: (id: string, by: string) => void;
  reject: (id: string, note: string) => void;
  resetDemo: () => void;
}
const KEY = 'kairad_inventory_v3';
const InvCtx = createContext<Ctx | null>(null);
export const useInventory = () => { const c = useContext(InvCtx); if (!c) throw new Error('InventoryProvider missing'); return c; };

function load(): State {
  try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s) as State; } catch { /* storage unavailable */ }
  return seed();
}

export function InventoryProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<State>(load);
  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ } }, [s]);
  // keep several open tabs (e.g. dashboard on a wall screen, counts on a laptop) in sync in real time
  useEffect(() => {
    const on = (e: StorageEvent) => { if (e.key === KEY && e.newValue) { try { setS(JSON.parse(e.newValue)); } catch { /* ignore */ } } };
    window.addEventListener('storage', on); return () => window.removeEventListener('storage', on);
  }, []);

  const patchJob = (id: string, fn: (j: CountJob) => CountJob) => setS((p) => ({ ...p, jobs: p.jobs.map((j) => (j.id === id ? fn(j) : j)) }));
  const uid = () => `it${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

  const api: Ctx = {
    ...s,
    addOrUpdate(rows) {
      let added = 0, updated = 0;
      const items = [...s.items];
      for (const row of rows) {
        const i = items.findIndex((x) => x.sku.toLowerCase() === row.sku.toLowerCase() && x.warehouse === row.warehouse && x.location.toLowerCase() === row.location.toLowerCase());
        if (i >= 0) { items[i] = { ...items[i], ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) }; updated++; } else { items.push({ ...row, id: uid() }); added++; }
      }
      setS({ ...s, items });
      return { added, updated };
    },
    updateItem: (id, patch) => setS((p) => ({ ...p, items: p.items.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    removeItem: (id) => setS((p) => ({ ...p, items: p.items.filter((x) => x.id !== id) })),
    requestCount({ type, targets, operative, priority, note }) {
      const n = Math.max(1040, ...s.jobs.map((j) => Number(j.id.replace('CC-', '')) || 0)) + 1;
      const id = `CC-${n}`;
      const sel = s.items.filter((it) => (type === 'LOCATION' ? targets.includes(locKey(it.warehouse, it.location)) : targets.includes(it.sku)));
      const job: CountJob = { id, type, targets, operative, priority, note, requestedAt: new Date().toISOString(), stage: 1, scans: [], lines: sel.map((it) => ({ itemId: it.id, sku: it.sku, warehouse: it.warehouse, location: it.location, uom: it.uom, expected: it.quantity, counted: null })) };
      setS({ ...s, jobs: [job, ...s.jobs] });
      return id;
    },
    startCount: (id) => patchJob(id, (j) => (j.stage === 1 ? { ...j, stage: 2, startedAt: new Date().toISOString() } : j)),
    updateJob: patchJob,
    setCounted: (id, itemId, v) => patchJob(id, (j) => ({ ...j, lines: j.lines.map((l) => (l.itemId === itemId ? { ...l, counted: v, recount: v === null ? l.recount : false } : l)) })),
    finishCount: (id) => patchJob(id, (j) => (j.stage === 2 && j.lines.every((l) => l.counted !== null) ? { ...j, stage: 3, rejectedNote: undefined, finishedAt: new Date().toISOString() } : j)),
    recountLine: (id, itemId) => patchJob(id, (j) => ({ ...j, stage: 2, lines: j.lines.map((l) => (l.itemId === itemId ? { ...l, counted: null, recount: true } : l)) })),
    sendForApproval: (id) => patchJob(id, (j) => (j.stage === 3 ? { ...j, stage: 4 } : j)),
    approve(id, by) {
      setS((p) => {
        const job = p.jobs.find((j) => j.id === id);
        if (!job || job.stage !== 4) return p;
        const now = new Date().toISOString();
        const hist: HistoryEntry[] = job.lines.map((l, i) => ({ id: `${id}-${i}`, countId: id, date: now, sku: l.sku, warehouse: l.warehouse, location: l.location, uom: l.uom, expected: l.expected, counted: l.counted ?? l.expected, adjusted: (l.counted ?? l.expected) !== l.expected, approvedBy: by, method: job.method }));
        let items = p.items.map((it) => { const l = job.lines.find((x) => x.itemId === it.id); return l && l.counted !== null ? { ...it, quantity: l.counted } : it; });
        // stock found at a bin where the system had none becomes a real stock line once approved
        for (const l of job.lines) if (l.extra && l.counted) { const tpl = p.items.find((x) => x.sku === l.sku); items = [...items, { id: uid(), sku: l.sku, description: tpl?.description ?? '', quantity: l.counted, uom: l.uom, warehouse: l.warehouse, location: l.location, skuCode: tpl?.skuCode, weeklyDemand: tpl?.weeklyDemand, storageType: tpl?.storageType, ti: tpl?.ti, hi: tpl?.hi, unitsPerPack: tpl?.unitsPerPack, isStackable: tpl?.isStackable, maxStackUnits: tpl?.maxStackUnits, oem: tpl?.oem, manufacturer: tpl?.manufacturer, custom: tpl?.custom }]; }
        return { items, history: [...p.history, ...hist], jobs: p.jobs.map((j) => (j.id === id ? { ...j, stage: 5, approvedBy: by, completedAt: now } : j)) };
      });
    },
    reject: (id, note) => patchJob(id, (j) => ({ ...j, stage: 2, rejectedNote: note || 'Returned by Inventory Control Manager for recount', lines: j.lines.map((l) => (l.counted !== null && l.counted !== l.expected ? { ...l, counted: null, recount: true } : l)) })),
    resetDemo: () => setS(seed()),
  };
  return <InvCtx.Provider value={api}>{children}</InvCtx.Provider>;
}

export const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—');
export const fmtPct = (n: number | null) => (n === null ? '—' : (n * 100).toFixed(1) + '%');
export const num = (n: number) => n.toLocaleString('en-IN');
