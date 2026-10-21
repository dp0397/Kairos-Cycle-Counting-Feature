import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../../shared/skuIngest.js';
import { IngestionError, rejectRecord, resolveRecord, runIngestion, skuRowCode, type Db } from '../src/services/skuIngestService.js';

/** Minimal in-memory stand-in for the Prisma calls the service makes. */
function fakeDb() {
  const t = { warehouses: [{ id: 'w1', code: 'DEE', name: 'CWC Deesa' }, { id: 'w2', code: 'AMD', name: 'CWC Ahmedabad' }], skus: [] as any[], runs: [] as any[], recs: [] as any[] };
  let n = 0; const id = (p: string) => `${p}${++n}`;
  const apply = (row: any, data: any) => { for (const [k, v] of Object.entries(data)) { if (v && typeof v === 'object' && ('increment' in (v as any) || 'decrement' in (v as any))) row[k] += ((v as any).increment ?? 0) - ((v as any).decrement ?? 0); else row[k] = v; } };
  const db: any = {
    warehouse: { findMany: async () => t.warehouses },
    sku: {
      findMany: async () => t.skus.map((s) => ({ name: s.name, locationCode: s.locationCode, warehouse: t.warehouses.find((w) => w.id === s.warehouseId) ?? null })),
      upsert: async ({ where, create, update }: any) => { const ex = t.skus.find((s) => s.code === where.code); if (ex) { apply(ex, update); return ex; } const row = { id: id('sku'), ...create }; t.skus.push(row); return row; },
    },
    ingestionRun: {
      create: async ({ data }: any) => { const r = { id: id('run'), ...data }; t.runs.push(r); return r; },
      update: async ({ where, data }: any) => { apply(t.runs.find((r) => r.id === where.id), data); },
      findMany: async () => t.runs, findUnique: async ({ where }: any) => t.runs.find((r) => r.id === where.id) ?? null,
    },
    stagingRecord: {
      create: async ({ data }: any) => { const r = { id: id('rec'), ...data }; t.recs.push(r); return r; },
      update: async ({ where, data }: any) => { apply(t.recs.find((r) => r.id === where.id), data); },
      findMany: async () => t.recs, findUnique: async ({ where }: any) => t.recs.find((r) => r.id === where.id) ?? null,
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { db: db as Db, t };
}

const HEAD = 'MATNR,MAKTX,Qty,UoM,Ti,Hi,Stackable,Max Stack,Plant,Bin,Shelf Life Days';
const csv = (...rows: string[]) => parseCsv([HEAD, ...rows].join('\n'));
const GOOD = 'Basmati 25kg,Premium basmati bag,1840,Sacks,10,5,yes,3,CWC Deesa,A-01-01,365';

let h: ReturnType<typeof fakeDb>;
beforeEach(() => { h = fakeDb(); });

describe('runIngestion', () => {
  it('previews without writing anything', async () => {
    const out = await runIngestion(h.db, { table: csv(GOOD), source: 'CSV', dryRun: true });
    expect(out.runId).toBeNull();
    expect(out.summary).toMatchObject({ ready: 1, held: 0 });
    expect(h.t.skus).toHaveLength(0);
    expect(h.t.runs).toHaveLength(0);
  });

  it('writes ready rows to the master with pack, stack and custom fields, and logs every row', async () => {
    const out = await runIngestion(h.db, { table: csv(GOOD, 'Bad row,,5,Sacks,10,5,yes,3,CWC Deesa,A-01-02,1'), source: 'CSV', filename: 'a.csv' });
    expect(out.summary).toMatchObject({ received: 2, ready: 1, held: 1 });
    expect(h.t.skus).toHaveLength(1);
    expect(h.t.skus[0]).toMatchObject({
      name: 'Basmati 25kg', warehouseId: 'w1', locationCode: 'A-01-01', uom: 'SACKS', quantity: 1840, storageType: 'PALLET',
      ti: 10, hi: 5, unitsPerPack: 50, isStackable: true, maxStackUnits: 3, customAttributes: { 'Shelf Life Days': 365 }, source: 'CSV',
    });
    expect(h.t.recs.map((r) => r.status)).toEqual(['READY', 'HELD']);
    expect(h.t.runs[0]).toMatchObject({ received: 2, ready: 1, held: 1, filename: 'a.csv' });
  });

  it('re-uploading the same file updates in place instead of duplicating', async () => {
    await runIngestion(h.db, { table: csv(GOOD), source: 'CSV' });
    const again = await runIngestion(h.db, { table: csv(GOOD.replace('1840', '1900')), source: 'CSV' });
    expect(again.summary).toMatchObject({ update: 1, create: 0 });
    expect(h.t.skus).toHaveLength(1);
    expect(h.t.skus[0].quantity).toBe(1900);
  });

  it('holds a row whose warehouse is not set up and suggests the closest one', async () => {
    const out = await runIngestion(h.db, { table: csv(GOOD.replace('CWC Deesa', 'Deesa')), source: 'CSV' });
    expect(out.rows[0].status).toBe('HELD');
    expect(out.rows[0].issues.find((i) => i.code === 'UNKNOWN_WAREHOUSE')?.suggestion).toMatch(/CWC Deesa/);
    expect(h.t.skus).toHaveLength(0);
  });

  it('accepts a warehouse given by code and allows a blank warehouse and location', async () => {
    const out = await runIngestion(h.db, { table: csv(GOOD.replace('CWC Deesa', 'dee'), 'Loose item,Spare,3,Eaches,4,2,no,,,,'), source: 'CSV' });
    expect(out.summary).toMatchObject({ ready: 2, held: 0 });
    expect(h.t.skus[0].warehouseId).toBe('w1');
    expect(h.t.skus[1]).toMatchObject({ warehouseId: null, locationCode: 'UNASSIGNED' });
  });

  it('keeps two SKUs whose names differ only by punctuation as separate master rows', () => {
    expect(skuRowCode('A B', 'DEE', 'A1')).not.toBe(skuRowCode('A-B', 'DEE', 'A1'));
    expect(skuRowCode('A B', 'DEE', 'A1')).toBe(skuRowCode('a  b', 'dee', 'a1'));
  });
});

describe('exception inbox', () => {
  const heldRun = () => runIngestion(h.db, { table: csv('Wheat Flour,Atta 50kg,200,Sacks,8,4,,,CWC Deesa,B-01-01,'), source: 'CSV' });

  it('lets a person supply the missing stackable flag and publishes the SKU', async () => {
    await heldRun();
    expect(h.t.recs[0].status).toBe('HELD');
    const out = await resolveRecord(h.db, h.t.recs[0].id, { isStackable: 'no' }, 'user1');
    expect(out.status).toBe('RESOLVED');
    expect(h.t.skus).toHaveLength(1);
    expect(h.t.recs[0]).toMatchObject({ status: 'RESOLVED', resolvedById: 'user1' });
    expect(h.t.runs[0]).toMatchObject({ held: 0, ready: 1, created: 1 });
  });

  it('keeps the record held, with fresh messages, when the fix is still incomplete', async () => {
    await heldRun();
    const out = await resolveRecord(h.db, h.t.recs[0].id, { isStackable: 'yes' });
    expect(out.status).toBe('HELD');
    expect(out.issues.some((i) => i.field === 'maxStackUnits')).toBe(true);
    expect(h.t.skus).toHaveLength(0);
    const done = await resolveRecord(h.db, h.t.recs[0].id, { maxStackUnits: '2' });
    expect(done.status).toBe('RESOLVED');
  });

  it('can reject a held record and refuses to act on one that is no longer held', async () => {
    await heldRun();
    await rejectRecord(h.db, h.t.recs[0].id);
    expect(h.t.recs[0].status).toBe('REJECTED');
    expect(h.t.runs[0].held).toBe(0);
    await expect(resolveRecord(h.db, h.t.recs[0].id, {})).rejects.toBeInstanceOf(IngestionError);
    await expect(rejectRecord(h.db, 'nope')).rejects.toMatchObject({ statusCode: 404 });
  });
});
