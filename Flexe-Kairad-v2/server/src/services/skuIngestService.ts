import {
  FIELDS, ingest, keyOf, resolveRow, summarise,
  type Canon, type Field, type IngestRow, type Issue, type NormalizedRow,
} from '../../../shared/skuIngest.js';

/**
 * Persistence around the pure ingestion engine (shared/skuIngest.ts).
 * It only touches the database through the small `Db` surface below, so the logic is
 * unit-tested against an in-memory fake and the real Prisma client drops in unchanged.
 */

type Row = Record<string, any>;
export interface Tx {
  warehouse: { findMany(args?: any): Promise<{ id: string; code: string; name: string }[]> };
  sku: { findMany(args?: any): Promise<Row[]>; upsert(args: any): Promise<{ id: string }> };
  ingestionRun: { create(args: any): Promise<{ id: string }>; update(args: any): Promise<unknown>; findMany(args?: any): Promise<Row[]>; findUnique(args: any): Promise<Row | null> };
  stagingRecord: { create(args: any): Promise<{ id: string }>; update(args: any): Promise<unknown>; findMany(args?: any): Promise<Row[]>; findUnique(args: any): Promise<Row | null> };
}
export interface Db extends Tx { $transaction<T>(fn: (tx: Tx) => Promise<T>, opts?: { timeout?: number; maxWait?: number }): Promise<T> }

export class IngestionError extends Error { constructor(public statusCode: number, message: string) { super(message); } }

interface Wh { id: string; code: string; name: string }
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const hash = (s: string) => { let h = 5381; for (const c of s) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36); };
/** One SKU master row per SKU + warehouse + location. The hash keeps "A B" and "A-B" from colliding. */
export function skuRowCode(name: string, warehouseCode: string | null | undefined, location: string | null | undefined) {
  const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${slug(warehouseCode ?? '') || 'NOWH'}-${slug(location ?? '') || 'UNASSIGNED'}-${slug(name).slice(0, 60)}-${hash(keyOf(name, warehouseCode, location))}`;
}

async function loadExistingKeys(db: Tx): Promise<Set<string>> {
  const skus = await db.sku.findMany({ select: { name: true, locationCode: true, warehouse: { select: { name: true, code: true } } } });
  const keys = new Set<string>();
  for (const s of skus) {
    keys.add(keyOf(s.name, s.warehouse?.name, s.locationCode));
    if (s.warehouse?.code) keys.add(keyOf(s.name, s.warehouse.code, s.locationCode));
  }
  return keys;
}

async function loadWarehouseIndex(db: Tx) {
  const all = await db.warehouse.findMany({ select: { id: true, code: true, name: true } });
  const byKey = new Map<string, Wh>();
  all.forEach((w) => { byKey.set(norm(w.name), w); byKey.set(norm(w.code), w); });
  return { byKey, names: all.map((w) => w.name) };
}
type WhIndex = Awaited<ReturnType<typeof loadWarehouseIndex>>;

/** Warehouse is optional, but a name that matches none we know is held rather than silently dropped. */
function checkWarehouse(row: { data: Partial<NormalizedRow>; issues: Issue[]; status?: string }, idx: WhIndex): Wh | null {
  const name = row.data.warehouse; if (!name) return null;
  const hit = idx.byKey.get(norm(name));
  if (hit) return hit;
  const near = idx.names.filter((n) => norm(n).includes(norm(name)) || norm(name).includes(norm(n))).slice(0, 3);
  row.issues.push({ code: 'UNKNOWN_WAREHOUSE', severity: 'ERROR', field: 'warehouse', message: `Warehouse "${name}" is not set up in the platform`, suggestion: near.length ? `Did you mean ${near.join(' or ')}?` : 'Pick an existing warehouse or leave it blank' });
  row.status = 'HELD';
  return null;
}

async function writeSku(tx: Tx, d: NormalizedRow, wh: Wh | null, runId: string, source: string) {
  const code = skuRowCode(d.skuName, wh?.code ?? d.warehouse, d.location);
  const payload = {
    name: d.skuName, description: d.description, quantity: d.quantity, uom: d.uom,
    warehouseId: wh?.id ?? null, locationCode: d.location ?? 'UNASSIGNED', barcode: d.skuCode,
    storageType: d.storageType, ti: d.ti, hi: d.hi, unitsPerPack: d.unitsPerPack, isStackable: d.isStackable, maxStackUnits: d.maxStackUnits,
    oem: d.oem, manufacturer: d.manufacturer, weeklyDemand: d.weeklyDemand, customAttributes: json(d.customAttributes ?? {}), source, lastRunId: runId,
  };
  return tx.sku.upsert({ where: { code }, create: { code, ...payload }, update: payload });
}

export interface RunInput { table: string[][]; source: string; filename?: string; defaults?: Canon; userId?: string; dryRun?: boolean }

export async function runIngestion(db: Db, input: RunInput) {
  const [existingKeys, idx] = await Promise.all([loadExistingKeys(db), loadWarehouseIndex(db)]);
  const result = ingest(input.table, { existingKeys, defaults: input.defaults });
  const whByRow = new Map<number, Wh | null>();
  for (const r of result.rows) if (r.status === 'READY') whByRow.set(r.rowNumber, checkWarehouse(r, idx));
  const summary = summarise(result.rows);
  if (input.dryRun) return { runId: null as string | null, ...result, summary };

  const run = await db.$transaction(async (tx) => {
    const created = await tx.ingestionRun.create({ data: {
      source: input.source, filename: input.filename ?? null, received: summary.received, ready: summary.ready, held: summary.held, dropped: summary.dropped,
      created: summary.create, updated: summary.update, autoFixed: summary.autoFixed, mapping: json(result.mapping), fileIssues: json(result.fileIssues), createdById: input.userId ?? null,
    } });
    for (const r of result.rows) {
      const sku = r.status === 'READY' ? await writeSku(tx, r.data as NormalizedRow, whByRow.get(r.rowNumber) ?? null, created.id, input.source) : null;
      await tx.stagingRecord.create({ data: {
        runId: created.id, rowNumber: r.rowNumber, status: r.status, action: r.action, rowKey: r.key,
        canon: json(r.canon), extras: json(r.extras), data: json(r.data), issues: json(r.issues), skuId: sku?.id ?? null,
      } });
    }
    return created;
  }, { timeout: 120_000, maxWait: 10_000 });
  return { runId: run.id as string | null, ...result, summary };
}

export const cleanFields = (o: Record<string, unknown>): Canon => {
  const out: Canon = {};
  for (const f of FIELDS) { const v = o[f]; if (typeof v === 'string') out[f as Field] = v.trim(); }
  return out;
};

/** A person fixes a held row in the inbox. Valid: written to the master. Still invalid: stays held with fresh messages. */
export async function resolveRecord(db: Db, id: string, overrides: Canon, userId?: string) {
  const rec = await db.stagingRecord.findUnique({ where: { id } });
  if (!rec) throw new IngestionError(404, 'record not found');
  if (rec.status !== 'HELD') throw new IngestionError(409, `record is ${String(rec.status).toLowerCase()}, not held`);
  const canon: Canon = { ...(rec.canon as Canon) };
  for (const [k, v] of Object.entries(overrides)) { if (v === '') delete canon[k as Field]; else canon[k as Field] = v; }
  const [existingKeys, idx] = await Promise.all([loadExistingKeys(db), loadWarehouseIndex(db)]);
  const r = resolveRow(canon, rec.extras as Record<string, string>, existingKeys);
  const probe: { data: Partial<NormalizedRow>; issues: Issue[]; status: string } = { data: r.data, issues: r.issues, status: r.status };
  const wh = probe.status === 'READY' ? checkWarehouse(probe, idx) : null;
  const base = { canon: json(canon), data: json(r.data), issues: json(probe.issues), rowKey: r.key, action: r.action };
  if (probe.status === 'HELD') {
    await db.stagingRecord.update({ where: { id }, data: base });
    return { status: 'HELD' as const, issues: probe.issues, data: r.data };
  }
  await db.$transaction(async (tx) => {
    const run = await tx.ingestionRun.findUnique({ where: { id: rec.runId } });
    const sku = await writeSku(tx, r.data as NormalizedRow, wh, rec.runId, run?.source ?? 'MANUAL');
    await tx.stagingRecord.update({ where: { id }, data: { ...base, status: 'RESOLVED', skuId: sku.id, resolvedAt: new Date(), resolvedById: userId ?? null } });
    await tx.ingestionRun.update({ where: { id: rec.runId }, data: { held: { decrement: 1 }, ready: { increment: 1 }, ...(r.action === 'UPDATE' ? { updated: { increment: 1 } } : { created: { increment: 1 } }) } });
  });
  return { status: 'RESOLVED' as const, issues: probe.issues, data: r.data };
}

export async function rejectRecord(db: Db, id: string, userId?: string) {
  const rec = await db.stagingRecord.findUnique({ where: { id } });
  if (!rec) throw new IngestionError(404, 'record not found');
  if (rec.status !== 'HELD') throw new IngestionError(409, `record is ${String(rec.status).toLowerCase()}, not held`);
  await db.$transaction(async (tx) => {
    await tx.stagingRecord.update({ where: { id }, data: { status: 'REJECTED', resolvedAt: new Date(), resolvedById: userId ?? null } });
    await tx.ingestionRun.update({ where: { id: rec.runId }, data: { held: { decrement: 1 } } });
  });
  return { status: 'REJECTED' as const };
}

export type { IngestRow };
