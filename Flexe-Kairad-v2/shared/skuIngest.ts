/**
 * SKU ingestion engine: header mapping, normalisation, validation and de-duplication.
 * Pure TypeScript with no I/O and no dependencies, so the browser (CSV preview) and the
 * server (API + persisted runs) run exactly the same rules.
 *
 * Mandatory: SKU name, description, quantity, unit of measure, pack data
 * (Ti x Hi + units per pallet for pallet items, units per bin for bin items)
 * and stackability (checkbox + units allowed to stack when ticked).
 * Everything else is optional; unmapped columns are kept as custom attributes.
 */

export const UOMS = ['EACHES', 'PALLETS', 'CARTONS', 'SACKS'] as const;
export type Uom = (typeof UOMS)[number];
export type StorageType = 'PALLET' | 'BIN';

export const FIELDS = [
  'skuName', 'description', 'quantity', 'uom', 'storageType', 'ti', 'hi', 'tiHi', 'unitsPerPack',
  'isStackable', 'maxStackUnits', 'skuCode', 'warehouse', 'location', 'oem', 'manufacturer', 'weeklyDemand',
] as const;
export type Field = (typeof FIELDS)[number];
export type Canon = Partial<Record<Field, string>>;

export const FIELD_LABEL: Record<Field, string> = {
  skuName: 'SKU name', description: 'Description', quantity: 'Quantity', uom: 'Unit of measure', storageType: 'Storage type',
  ti: 'Ti (units per layer)', hi: 'Hi (layers per pallet)', tiHi: 'Ti x Hi', unitsPerPack: 'Units per pallet / bin',
  isStackable: 'Stackable', maxStackUnits: 'Units allowed to stack', skuCode: 'SKU code / barcode', warehouse: 'Warehouse',
  location: 'Location', oem: 'OEM', manufacturer: 'Manufacturer', weeklyDemand: 'Weekly demand',
};

/** Columns a file should have; a missing one holds every row unless a whole-file default is supplied. */
export const REQUIRED_COLUMNS: Field[] = ['skuName', 'description', 'quantity', 'uom', 'isStackable'];

/* ───────────── header mapping ───────────── */

// Ordered by preference: when two columns claim one field, the earlier synonym wins.
const SYNONYMS: Record<Field, string[]> = {
  skuName: ['skuname', 'sku', 'itemname', 'productname', 'name', 'product', 'item', 'itemno', 'itemnumber', 'partnumber', 'partno', 'material', 'materialnumber', 'matnr', 'itemcode'],
  description: ['description', 'desc', 'itemdescription', 'productdescription', 'longdescription', 'description1', 'maktx', 'materialdescription'],
  quantity: ['quantity', 'qty', 'quantityonhand', 'qtyonhand', 'qoh', 'onhand', 'onhandqty', 'stock', 'stockqty', 'availableqty', 'labst'],
  uom: ['uom', 'unitofmeasure', 'unit', 'um', 'baseuom', 'meins', 'qtyuom'],
  storageType: ['storagetype', 'handlingunit', 'handlingunittype', 'binorpallet', 'storagemode'],
  ti: ['ti', 'tie', 'tiequantity', 'unitsperlayer', 'casesperlayer', 'cartonsperlayer', 'layerqty'],
  hi: ['hi', 'high', 'layers', 'layersperpallet', 'layercount'],
  tiHi: ['tihi', 'tixhi', 'palletpattern', 'palletconfig', 'palletconfiguration', 'tihipattern'],
  unitsPerPack: ['unitsperpallet', 'unitsperbin', 'unitsperpalletorbin', 'unitsperpalletbin', 'palletqty', 'binqty', 'qtyperpallet', 'qtyperbin', 'casesperpallet', 'cartonsperpallet', 'sacksperpallet', 'bagsperpallet', 'eachesperpallet', 'casepack', 'packsize', 'unitsperpack', 'numberofunits'],
  isStackable: ['stackable', 'isstackable', 'stackability', 'stackflag', 'canstack', 'stackingallowed'],
  maxStackUnits: ['maxstackunits', 'maxstack', 'stacklimit', 'stackinglimit', 'maxstackheight', 'unitsallowedtostack', 'stackunits', 'numberstackable', 'stackquantity'],
  skuCode: ['skucode', 'barcode', 'gtin', 'upc', 'ean', 'skutag', 'barcodeid'],
  warehouse: ['warehouse', 'wh', 'site', 'plant', 'facility', 'depot', 'warehousename'],
  location: ['location', 'bin', 'binlocation', 'loc', 'slot', 'storagelocation', 'rack'],
  oem: ['oem', 'oemname', 'oempartnumber'],
  manufacturer: ['manufacturer', 'mfr', 'mfg', 'manufacturername', 'maker'],
  weeklyDemand: ['weeklydemand', 'demand', 'weeklyunits', 'weeklyshipped'],
};

const SYN_INDEX = new Map<string, { field: Field; rank: number }>();
(Object.keys(SYNONYMS) as Field[]).forEach((f) => SYNONYMS[f].forEach((s, rank) => { if (!SYN_INDEX.has(s)) SYN_INDEX.set(s, { field: f, rank }); }));

export const normHeader = (s: string) => s.replace(/^﻿/, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function bigrams(s: string) { const out = new Map<string, number>(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); out.set(g, (out.get(g) ?? 0) + 1); } return out; }
function dice(a: string, b: string) {
  if (a === b) return 1; if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a), B = bigrams(b); let hit = 0;
  for (const [g, n] of A) hit += Math.min(n, B.get(g) ?? 0);
  return (2 * hit) / (a.length - 1 + b.length - 1);
}

export interface MappedColumn { index: number; header: string; field: Field | null; confidence: number; method: 'exact' | 'fuzzy' | 'none' | 'collision' }
export interface MappingReport { columns: MappedColumn[]; unmappedRequired: Field[] }

/** Deterministic mapping: exact synonym, then fuzzy (>= 0.82 similarity). Unmatched columns become custom attributes. */
export function mapHeaders(headers: string[]): MappingReport {
  const cand: (MappedColumn & { rank: number })[] = headers.map((h, index) => {
    const n = normHeader(h);
    const hit = SYN_INDEX.get(n);
    if (hit) return { index, header: h, field: hit.field, confidence: 1, method: 'exact' as const, rank: hit.rank };
    if (n.length >= 4) {
      let best: { field: Field; score: number; rank: number } | null = null;
      for (const [syn, v] of SYN_INDEX) { if (syn.length < 4) continue; const s = dice(n, syn); if (s >= 0.82 && (!best || s > best.score)) best = { field: v.field, score: s, rank: v.rank + 50 }; }
      if (best) return { index, header: h, field: best.field, confidence: Math.round(best.score * 100) / 100, method: 'fuzzy' as const, rank: best.rank };
    }
    return { index, header: h, field: null, confidence: 0, method: 'none' as const, rank: 999 };
  });
  const winner = new Map<Field, number>();
  cand.forEach((c, i) => {
    if (!c.field) return;
    const w = winner.get(c.field);
    if (w === undefined || c.rank < cand[w].rank || (c.rank === cand[w].rank && c.confidence > cand[w].confidence)) winner.set(c.field, i);
  });
  const columns: MappedColumn[] = cand.map((c, i) => {
    const { rank: _rank, ...col } = c;
    if (c.field && winner.get(c.field) !== i) return { ...col, field: null, confidence: 0, method: 'collision' as const };
    return col;
  });
  const have = new Set(columns.map((c) => c.field));
  const unmappedRequired = REQUIRED_COLUMNS.filter((f) => !have.has(f));
  return { columns, unmappedRequired };
}

/* ───────────── value parsing ───────────── */

const parseNum = (s: string): number | null => { const t = s.replace(/[,\s]/g, ''); if (t === '' || !/^-?\d*\.?\d+$/.test(t)) return null; const n = Number(t); return Number.isFinite(n) ? n : null; };
const parsePosInt = (s: string): number | null => { const n = parseNum(s); return n !== null && Number.isInteger(n) && n >= 1 ? n : null; };
const QTY_UNIT = /^\s*(\d[\d,]*\.?\d*)\s*([a-zA-Z]+)\s*$/;
const TI_HI_X = /^\s*(\d+)\s*(?:x|×|\*|by)\s*(\d+)\s*$/i;
const TI_HI_LABELLED = /ti\D*(\d+)\D+hi\D*(\d+)/i;

const UOM_ALIAS: Record<string, Uom> = {
  each: 'EACHES', eaches: 'EACHES', ea: 'EACHES', pc: 'EACHES', pcs: 'EACHES', piece: 'EACHES', pieces: 'EACHES', unit: 'EACHES', units: 'EACHES',
  pallet: 'PALLETS', pallets: 'PALLETS', plt: 'PALLETS', plts: 'PALLETS',
  carton: 'CARTONS', cartons: 'CARTONS', ctn: 'CARTONS', ctns: 'CARTONS', case: 'CARTONS', cases: 'CARTONS', cs: 'CARTONS', box: 'CARTONS', boxes: 'CARTONS',
  sack: 'SACKS', sacks: 'SACKS', bag: 'SACKS', bags: 'SACKS', sk: 'SACKS',
};
const ASSUMED_UOM = new Set(['unit', 'units', 'case', 'cases', 'cs', 'box', 'boxes']);
export const UOM_DISPLAY: Record<Uom, string> = { EACHES: 'Eaches', PALLETS: 'Pallets', CARTONS: 'Cartons', SACKS: 'Sacks' };

const parseBool = (s: string): boolean | undefined => {
  const t = s.trim().toLowerCase();
  if (['y', 'yes', 'true', 't', '1', 'x', 'stackable', 'checked'].includes(t)) return true;
  if (['n', 'no', 'false', 'f', '0', 'not stackable', 'unchecked', 'do not stack'].includes(t)) return false;
  return undefined;
};

/* ───────────── row evaluation ───────────── */

export type Severity = 'ERROR' | 'WARNING' | 'FIXED';
export interface Issue { code: string; severity: Severity; field?: string; message: string; suggestion?: string }

export interface NormalizedRow {
  skuName: string; description: string; quantity: number; uom: Uom; storageType: StorageType;
  ti: number | null; hi: number | null; unitsPerPack: number; isStackable: boolean; maxStackUnits: number | null;
  skuCode: string | null; warehouse: string | null; location: string | null; oem: string | null; manufacturer: string | null;
  weeklyDemand: number | null; customAttributes: Record<string, string | number | boolean>;
}
export interface RowEval { data: Partial<NormalizedRow>; issues: Issue[]; ok: boolean }

const inferValue = (v: string): string | number | boolean => {
  const n = parseNum(v); if (n !== null && !/^0\d/.test(v.trim())) return n;
  const b = v.trim().toLowerCase(); if (b === 'true') return true; if (b === 'false') return false;
  return v.trim();
};

export function evaluateRow(c: Canon, extras: Record<string, string> = {}): RowEval {
  const issues: Issue[] = []; const d: Partial<NormalizedRow> = {};
  const add = (severity: Severity) => (code: string, field: string | undefined, message: string, suggestion?: string) => { issues.push({ code, severity, field, message, suggestion }); };
  const err = add('ERROR'), warn = add('WARNING'), fix = add('FIXED');
  const get = (f: Field) => (c[f] ?? '').toString().trim();
  const optional = (f: Field) => get(f) || null;

  // name + description
  const name = get('skuName'), desc = get('description');
  if (!name) err('MISSING_FIELD', 'skuName', 'SKU name is required'); else d.skuName = name;
  if (!desc) err('MISSING_FIELD', 'description', 'Description is required');
  else { d.description = desc; if (name && desc.toLowerCase() === name.toLowerCase()) warn('DESCRIPTION_SAME_AS_NAME', 'description', 'Description just repeats the SKU name'); }

  // quantity + unit of measure
  let qtyRaw = get('quantity'), uomRaw = get('uom');
  const split = qtyRaw.match(QTY_UNIT);
  if (split && !uomRaw) { fix('QTY_UOM_SPLIT', 'quantity', `Split "${qtyRaw}" into quantity ${split[1]} and unit "${split[2]}"`); qtyRaw = split[1]; uomRaw = split[2]; }
  if (qtyRaw === '') err('MISSING_FIELD', 'quantity', 'Quantity is required');
  else { const q = parseNum(qtyRaw); if (q === null || q < 0) err('INVALID_NUMBER', 'quantity', `Quantity "${qtyRaw}" is not a number of 0 or more`); else d.quantity = q; }
  if (uomRaw === '') err('MISSING_FIELD', 'uom', 'Unit of measure is required', 'Eaches, Pallets, Cartons or Sacks');
  else {
    const u = UOM_ALIAS[uomRaw.toLowerCase().replace(/[^a-z]/g, '')];
    if (!u) err('INVALID_UOM', 'uom', `Unit of measure "${uomRaw}" is not recognised`, 'Eaches, Pallets, Cartons or Sacks');
    else { d.uom = u; if (ASSUMED_UOM.has(uomRaw.toLowerCase())) fix('UOM_NORMALISED', 'uom', `"${uomRaw}" treated as ${UOM_DISPLAY[u]}`); }
  }

  // pack data
  const optInt = (f: Field): { v: number | null; bad: boolean } => {
    const raw = get(f); if (!raw) return { v: null, bad: false };
    const n = parsePosInt(raw); if (n === null) { err('INVALID_NUMBER', f, `${FIELD_LABEL[f]} "${raw}" must be a whole number of 1 or more`); return { v: null, bad: true }; }
    return { v: n, bad: false };
  };
  const tiIn = optInt('ti'), hiIn = optInt('hi'), up = optInt('unitsPerPack');
  let ti = tiIn.v, hi = hiIn.v, units = up.v;
  const tihi = get('tiHi');
  if (tihi) {
    const m = tihi.match(TI_HI_X) ?? tihi.match(TI_HI_LABELLED);
    if (!m) err('TIHI_UNPARSEABLE', 'tiHi', `Could not read Ti x Hi from "${tihi}"`, 'Use a form like 10x5');
    else if (ti === null && hi === null) { ti = Number(m[1]); hi = Number(m[2]); fix('TIHI_SPLIT', 'tiHi', `Read "${tihi}" as Ti ${ti}, Hi ${hi}`); }
  }
  let storage: StorageType | undefined;
  const stRaw = get('storageType');
  if (stRaw) {
    if (/pallet|plt/i.test(stRaw)) storage = 'PALLET'; else if (/bin|tote|shelf|shelving/i.test(stRaw)) storage = 'BIN';
    else err('INVALID_VALUE', 'storageType', `Storage type "${stRaw}" must be Pallet or Bin`);
  } else if (ti !== null || hi !== null) { storage = 'PALLET'; fix('STORAGE_INFERRED', 'storageType', 'Treated as a pallet item because Ti x Hi was given'); }
  else if (units !== null) { storage = 'BIN'; fix('STORAGE_INFERRED', 'storageType', 'Treated as a bin item because only units per bin was given'); }
  const packBad = tiIn.bad || hiIn.bad || up.bad || (!!tihi && ti === null && hi === null);
  if (!storage && !stRaw && !packBad) err('MISSING_FIELD', 'packInfo', 'Pack data is required: Ti x Hi with units per pallet (pallet item) or units per bin (bin item)');
  if (storage === 'PALLET') {
    if (ti === null && hi !== null && units !== null && units % hi === 0) { ti = units / hi; fix('DERIVED_TI', 'ti', `Ti worked out as ${ti} (${units} units / ${hi} layers)`); }
    if (hi === null && ti !== null && units !== null && units % ti === 0) { hi = units / ti; fix('DERIVED_HI', 'hi', `Hi worked out as ${hi} (${units} units / Ti ${ti})`); }
    if (ti === null && !tiIn.bad) err('MISSING_FIELD', 'ti', 'Ti (units per layer) is required for pallet items');
    if (hi === null && !hiIn.bad) err('MISSING_FIELD', 'hi', 'Hi (layers per pallet) is required for pallet items');
    if (ti !== null && hi !== null) {
      if (units === null && !up.bad) { units = ti * hi; fix('DERIVED_UNITS', 'unitsPerPack', `Units per pallet set to Ti x Hi = ${units} (assumes one unit per position)`); }
      else if (units !== null && units !== ti * hi) warn('PACK_MISMATCH', 'unitsPerPack', `Ti x Hi is ${ti * hi} but units per pallet is ${units}`, 'Confirm which is right');
    }
  }
  if (storage === 'BIN' && units === null && !up.bad) err('MISSING_FIELD', 'unitsPerPack', 'Units per bin is required for bin items');
  if (storage) d.storageType = storage;
  d.ti = ti; d.hi = hi;
  if (units !== null) d.unitsPerPack = units;

  // stackability
  const sRaw = get('isStackable'); const mm = optInt('maxStackUnits'); let maxStack = mm.v; let stack: boolean | undefined;
  if (sRaw) { stack = parseBool(sRaw); if (stack === undefined) err('INVALID_VALUE', 'isStackable', `Stackable "${sRaw}" must be Yes or No`); }
  else if (maxStack !== null) { stack = maxStack > 1; fix('STACKABLE_INFERRED', 'isStackable', `Marked ${stack ? 'stackable' : 'not stackable'} from the stack limit of ${maxStack}`); }
  else err('MISSING_FIELD', 'isStackable', 'Stackable (yes / no) is required');
  if (stack === true && maxStack === null && !mm.bad) err('MISSING_FIELD', 'maxStackUnits', 'Stackable SKUs need the number of units allowed to stack');
  if (stack === false && maxStack !== null && maxStack > 1) err('STACK_CONFLICT', 'maxStackUnits', `Marked not stackable but a stack limit of ${maxStack} was given`, 'Set Stackable to Yes or clear the limit');
  if (stack !== undefined) d.isStackable = stack;
  d.maxStackUnits = stack === false ? null : maxStack;

  // optional fields
  d.skuCode = optional('skuCode'); d.warehouse = optional('warehouse'); d.location = optional('location'); d.oem = optional('oem'); d.manufacturer = optional('manufacturer');
  const dem = get('weeklyDemand');
  if (dem) { const n = parseNum(dem); if (n === null || n < 0) err('INVALID_NUMBER', 'weeklyDemand', `Weekly demand "${dem}" is not a number of 0 or more`); else d.weeklyDemand = Math.round(n); } else d.weeklyDemand = null;
  const custom: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(extras)) if (v.trim() !== '') custom[k] = inferValue(v);
  d.customAttributes = custom;

  return { data: d, issues, ok: !issues.some((i) => i.severity === 'ERROR') };
}

/* ───────────── whole-table ingestion ───────────── */

export const keyOf = (name: string, warehouse?: string | null, location?: string | null) => {
  const n = (s: string | null | undefined, dflt: string) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim() || dflt;
  return `${n(name, '')}|${n(warehouse, 'unassigned')}|${n(location, 'unassigned')}`;
};
const looseKey = (k: string) => k.replace(/[^a-z0-9|]/g, '');

export type RowStatus = 'READY' | 'HELD' | 'DROPPED';
export interface IngestRow { rowNumber: number; status: RowStatus; action: 'CREATE' | 'UPDATE'; key: string | null; canon: Canon; extras: Record<string, string>; data: Partial<NormalizedRow>; issues: Issue[] }
export interface IngestSummary { received: number; ready: number; held: number; dropped: number; create: number; update: number; autoFixed: number; byCode: Record<string, number> }
export interface IngestResult { mapping: MappingReport; rows: IngestRow[]; fileIssues: string[]; summary: IngestSummary }
export interface IngestOptions { existingKeys?: Iterable<string>; defaults?: Canon }

const fingerprint = (d: Partial<NormalizedRow>) => JSON.stringify([d.skuName, d.description, d.quantity, d.uom, d.storageType, d.ti, d.hi, d.unitsPerPack, d.isStackable, d.maxStackUnits, d.skuCode, d.oem, d.manufacturer, d.weeklyDemand]);

export function ingest(table: string[][], opts: IngestOptions = {}): IngestResult {
  const existing = new Set(opts.existingKeys ?? []);
  const empty: IngestSummary = { received: 0, ready: 0, held: 0, dropped: 0, create: 0, update: 0, autoFixed: 0, byCode: {} };
  if (table.length < 2) return { mapping: { columns: [], unmappedRequired: [...REQUIRED_COLUMNS] }, rows: [], fileIssues: ['No data rows found. The first row must be the header.'], summary: empty };
  const mapping = mapHeaders(table[0]);
  const defaults = opts.defaults ?? {};
  const fileIssues: string[] = [];
  const present = new Set(mapping.columns.map((c) => c.field));
  for (const f of mapping.unmappedRequired) if (!defaults[f]) fileIssues.push(`No column found for "${FIELD_LABEL[f]}". Rows will be held unless you set a value for the whole file.`);
  const hasPack = present.has('tiHi') || (present.has('ti') && present.has('hi')) || present.has('unitsPerPack') || !!defaults.unitsPerPack || !!defaults.tiHi;
  if (!hasPack) fileIssues.push('No pack columns found (Ti x Hi, units per pallet or units per bin). Every row will be held.');

  const rows: IngestRow[] = table.slice(1).map((cells, i) => {
    const canon: Canon = {}; const extras: Record<string, string> = {};
    mapping.columns.forEach((col) => {
      const v = (cells[col.index] ?? '').trim();
      if (col.field) { if (v !== '') canon[col.field] = v; } else if (v !== '') extras[col.header.trim() || `column_${col.index + 1}`] = v;
    });
    for (const f of Object.keys(defaults) as Field[]) if (canon[f] === undefined && defaults[f]) canon[f] = defaults[f];
    const ev = evaluateRow(canon, extras);
    const key = ev.data.skuName ? keyOf(ev.data.skuName, ev.data.warehouse, ev.data.location) : null;
    return { rowNumber: i + 2, status: 'READY' as RowStatus, action: (key && existing.has(key) ? 'UPDATE' : 'CREATE') as 'CREATE' | 'UPDATE', key, canon, extras, data: ev.data, issues: ev.issues };
  });

  // duplicates inside the file
  const groups = new Map<string, IngestRow[]>();
  rows.forEach((r) => { if (r.key) groups.set(r.key, [...(groups.get(r.key) ?? []), r]); });
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const same = g.every((r) => fingerprint(r.data) === fingerprint(g[0].data));
    if (same) g.slice(1).forEach((r) => { r.status = 'DROPPED'; r.issues.push({ code: 'DUPLICATE_EXACT', severity: 'FIXED', message: `Identical to row ${g[0].rowNumber}; dropped` }); });
    else g.forEach((r) => r.issues.push({ code: 'DUPLICATE_CONFLICT', severity: 'ERROR', field: 'skuName', message: `Same SKU, warehouse and location as row(s) ${g.filter((o) => o !== r).map((o) => o.rowNumber).join(', ')} but the values differ`, suggestion: 'Keep one row or correct the location' }));
  }
  // near duplicates (same once punctuation and spacing are ignored)
  const loose = new Map<string, IngestRow[]>();
  rows.filter((r) => r.key && r.status !== 'DROPPED').forEach((r) => { const k = looseKey(r.key!); loose.set(k, [...(loose.get(k) ?? []), r]); });
  for (const g of loose.values()) {
    if (new Set(g.map((r) => r.key)).size > 1) g.forEach((r) => r.issues.push({ code: 'NEAR_DUPLICATE', severity: 'WARNING', field: 'skuName', message: `Looks like row(s) ${g.filter((o) => o.key !== r.key).map((o) => o.rowNumber).join(', ')} apart from punctuation or spacing`, suggestion: 'Merge if they are the same SKU' }));
  }
  rows.forEach((r) => { if (r.status !== 'DROPPED') r.status = r.issues.some((i) => i.severity === 'ERROR') ? 'HELD' : 'READY'; });
  return { mapping, rows, fileIssues, summary: summarise(rows) };
}

export function summarise(rows: IngestRow[]): IngestSummary {
  const s: IngestSummary = { received: rows.length, ready: 0, held: 0, dropped: 0, create: 0, update: 0, autoFixed: 0, byCode: {} };
  for (const r of rows) {
    if (r.status === 'READY') { s.ready++; if (r.action === 'UPDATE') s.update++; else s.create++; } else if (r.status === 'HELD') s.held++; else s.dropped++;
    if (r.issues.some((i) => i.severity === 'FIXED')) s.autoFixed++;
    for (const i of r.issues) s.byCode[i.code] = (s.byCode[i.code] ?? 0) + 1;
  }
  return s;
}

/** Re-check one held row after a person edits it (exception inbox). Duplicates are re-checked against existing keys only. */
export function resolveRow(canon: Canon, extras: Record<string, string>, existingKeys: Iterable<string> = []): Pick<IngestRow, 'status' | 'action' | 'key' | 'data' | 'issues' | 'canon' | 'extras'> {
  const ev = evaluateRow(canon, extras); const ex = new Set(existingKeys);
  const key = ev.data.skuName ? keyOf(ev.data.skuName, ev.data.warehouse, ev.data.location) : null;
  return { status: ev.ok ? 'READY' : 'HELD', action: key && ex.has(key) ? 'UPDATE' : 'CREATE', key, data: ev.data, issues: ev.issues, canon, extras };
}

/* ───────────── CSV / JSON helpers ───────────── */

export function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Turn an array of JSON objects (API / ERP push) into the same header + rows table. */
export function objectsToTable(objs: Record<string, unknown>[]): string[][] {
  const headers: string[] = []; objs.forEach((o) => Object.keys(o).forEach((k) => { if (!headers.includes(k)) headers.push(k); }));
  return [headers, ...objs.map((o) => headers.map((h) => (o[h] === undefined || o[h] === null ? '' : String(o[h]))))];
}
