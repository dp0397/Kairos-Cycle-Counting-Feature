import { describe, expect, it } from 'vitest';
import { evaluateRow, ingest, keyOf, mapHeaders, objectsToTable, parseCsv, resolveRow } from '../../shared/skuIngest.js';

const good = { skuName: 'Basmati Rice 25kg', description: 'Premium basmati 25kg bag', quantity: '1840', uom: 'Sacks', ti: '10', hi: '5', unitsPerPack: '50', isStackable: 'yes', maxStackUnits: '3' };
const codes = (r: { issues: { code: string; severity: string }[] }, sev?: string) => r.issues.filter((i) => !sev || i.severity === sev).map((i) => i.code);

describe('mapHeaders', () => {
  it('maps common ERP header names without any configuration', () => {
    const m = mapHeaders(['MATNR', 'MAKTX', 'Qty On Hand', 'UoM', 'Ti x Hi', 'Max Stack', 'Stackable?']);
    expect(m.columns.map((c) => c.field)).toEqual(['skuName', 'description', 'quantity', 'uom', 'tiHi', 'maxStackUnits', 'isStackable']);
    expect(m.unmappedRequired).toEqual([]);
  });

  it('fuzzy-matches a misspelt header and leaves unknown ones unmapped', () => {
    const m = mapHeaders(['Descripton', 'Shelf Colour']);
    expect(m.columns[0]).toMatchObject({ field: 'description', method: 'fuzzy' });
    expect(m.columns[1]).toMatchObject({ field: null, method: 'none' });
  });

  it('gives one field to one column; the loser is demoted', () => {
    const m = mapHeaders(['SKU Name', 'Item No']);
    expect(m.columns[0].field).toBe('skuName');
    expect(m.columns[1]).toMatchObject({ field: null, method: 'collision' });
  });

  it('recognises the template headers exactly', () => {
    const m = mapHeaders(['sku_name', 'sku_code', 'description', 'quantity', 'uom', 'ti_x_hi', 'units_per_pallet_or_bin', 'stackable', 'max_stack_units', 'warehouse', 'location', 'weekly_demand', 'oem', 'manufacturer']);
    expect(m.columns.every((c) => c.method === 'exact')).toBe(true);
    expect(m.unmappedRequired).toEqual([]);
  });

  it('reports required fields with no column', () => {
    expect(mapHeaders(['sku', 'qty']).unmappedRequired).toEqual(['description', 'uom', 'isStackable']);
  });
});

describe('evaluateRow: mandatory fields', () => {
  it('accepts a complete pallet row', () => {
    const r = evaluateRow(good);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ skuName: 'Basmati Rice 25kg', quantity: 1840, uom: 'SACKS', storageType: 'PALLET', ti: 10, hi: 5, unitsPerPack: 50, isStackable: true, maxStackUnits: 3 });
    expect(r.issues).toEqual([{ code: 'STORAGE_INFERRED', severity: 'FIXED', field: 'storageType', message: expect.any(String), suggestion: undefined }]);
  });

  it('flags each missing mandatory field separately', () => {
    const r = evaluateRow({});
    expect(r.ok).toBe(false);
    expect(r.issues.filter((i) => i.code === 'MISSING_FIELD').map((i) => i.field).sort()).toEqual(['description', 'isStackable', 'packInfo', 'quantity', 'skuName', 'uom']);
  });

  it('treats location, warehouse, OEM and manufacturer as optional', () => {
    const r = evaluateRow(good);
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ location: null, warehouse: null, oem: null, manufacturer: null });
  });

  it('rejects negative or non-numeric quantity and unknown units', () => {
    expect(codes(evaluateRow({ ...good, quantity: '-4' }), 'ERROR')).toContain('INVALID_NUMBER');
    expect(codes(evaluateRow({ ...good, quantity: 'lots' }), 'ERROR')).toContain('INVALID_NUMBER');
    expect(codes(evaluateRow({ ...good, uom: 'drums' }), 'ERROR')).toContain('INVALID_UOM');
  });

  it('splits "12 cs" into quantity and unit when the unit column is empty', () => {
    const r = evaluateRow({ ...good, quantity: '12 cs', uom: '' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ quantity: 12, uom: 'CARTONS' });
    expect(codes(r, 'FIXED')).toEqual(expect.arrayContaining(['QTY_UOM_SPLIT', 'UOM_NORMALISED']));
  });
});

describe('evaluateRow: Ti x Hi and pack data', () => {
  const base = { skuName: 'Oil 15L', description: 'Groundnut oil tin', quantity: '310', uom: 'Cartons', isStackable: 'no' };

  it('reads combined Ti x Hi in several spellings', () => {
    for (const v of ['10x5', '10 X 5', '10*5', '10×5', 'TI 10 HI 5']) {
      const r = evaluateRow({ ...base, tiHi: v });
      expect(r.data).toMatchObject({ ti: 10, hi: 5, unitsPerPack: 50, storageType: 'PALLET' });
    }
  });

  it('derives units per pallet from Ti x Hi and says so', () => {
    const r = evaluateRow({ ...base, ti: '10', hi: '5' });
    expect(r.data.unitsPerPack).toBe(50);
    expect(codes(r, 'FIXED')).toContain('DERIVED_UNITS');
  });

  it('derives the missing Hi from units per pallet and Ti', () => {
    const r = evaluateRow({ ...base, ti: '10', unitsPerPack: '60', storageType: 'Pallet' });
    expect(r.data).toMatchObject({ ti: 10, hi: 6 });
  });

  it('warns, but does not hold, when Ti x Hi disagrees with units per pallet', () => {
    const r = evaluateRow({ ...base, ti: '10', hi: '5', unitsPerPack: '48' });
    expect(r.ok).toBe(true);
    expect(codes(r, 'WARNING')).toContain('PACK_MISMATCH');
  });

  it('holds a pallet item with Hi missing and no way to derive it', () => {
    const r = evaluateRow({ ...base, storageType: 'Pallet', ti: '10' });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.code === 'MISSING_FIELD')?.field).toBe('hi');
  });

  it('accepts a bin item with units per bin and no Ti x Hi', () => {
    const r = evaluateRow({ ...base, storageType: 'Bin', unitsPerPack: '24' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ storageType: 'BIN', unitsPerPack: 24, ti: null, hi: null });
  });

  it('holds a bin item with no units per bin', () => {
    const r = evaluateRow({ ...base, storageType: 'Bin' });
    expect(r.issues.find((i) => i.code === 'MISSING_FIELD')?.field).toBe('unitsPerPack');
  });

  it('flags unreadable Ti x Hi', () => {
    expect(codes(evaluateRow({ ...base, tiHi: 'ten by five' }), 'ERROR')).toContain('TIHI_UNPARSEABLE');
  });
});

describe('evaluateRow: stackability', () => {
  const base = { skuName: 'Crate', description: 'HDPE crate', quantity: '10', uom: 'Eaches', unitsPerPack: '20' };

  it('requires the stackable flag', () => {
    expect(evaluateRow(base).issues.some((i) => i.code === 'MISSING_FIELD' && i.field === 'isStackable')).toBe(true);
  });

  it('requires units allowed to stack when stackable is ticked', () => {
    const r = evaluateRow({ ...base, isStackable: 'Yes' });
    expect(r.ok).toBe(false);
    expect(r.issues.find((i) => i.field === 'maxStackUnits')?.code).toBe('MISSING_FIELD');
  });

  it('does not need a stack limit when not stackable', () => {
    const r = evaluateRow({ ...base, isStackable: 'No' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ isStackable: false, maxStackUnits: null });
  });

  it('infers stackable from a stack limit above 1', () => {
    const r = evaluateRow({ ...base, maxStackUnits: '4' });
    expect(r.ok).toBe(true);
    expect(r.data).toMatchObject({ isStackable: true, maxStackUnits: 4 });
    expect(codes(r, 'FIXED')).toContain('STACKABLE_INFERRED');
  });

  it('holds contradictory input: not stackable but a limit of 3', () => {
    expect(codes(evaluateRow({ ...base, isStackable: 'No', maxStackUnits: '3' }), 'ERROR')).toContain('STACK_CONFLICT');
  });

  it('rejects a value that is not yes or no', () => {
    expect(codes(evaluateRow({ ...base, isStackable: 'maybe' }), 'ERROR')).toContain('INVALID_VALUE');
  });
});

describe('custom attributes', () => {
  it('keeps unmapped columns with typed values', () => {
    const t = [['sku', 'desc', 'qty', 'uom', 'ti', 'hi', 'stackable', 'Shelf Life Days', 'Hazmat', 'Colour'], ['A', 'Item A', '5', 'ea', '4', '2', 'no', '180', 'false', 'Red']];
    const r = ingest(t).rows[0];
    expect(r.status).toBe('READY');
    expect(r.data.customAttributes).toEqual({ 'Shelf Life Days': 180, Hazmat: false, Colour: 'Red' });
  });
});

describe('ingest: duplicates', () => {
  const head = 'sku,description,qty,uom,ti,hi,stackable,max stack,warehouse,location';
  const csv = (...rows: string[]) => parseCsv([head, ...rows].join('\n'));

  it('drops an exact repeat and keeps the first', () => {
    const r = ingest(csv('Rice,Basmati,10,sacks,5,2,no,,W1,A1', 'Rice,Basmati,10,sacks,5,2,no,,W1,A1'));
    expect(r.rows.map((x) => x.status)).toEqual(['READY', 'DROPPED']);
    expect(r.summary).toMatchObject({ received: 2, ready: 1, dropped: 1 });
  });

  it('holds every copy when the same SKU+bin has different values', () => {
    const r = ingest(csv('Rice,Basmati,10,sacks,5,2,no,,W1,A1', 'Rice,Basmati,99,sacks,5,2,no,,W1,A1'));
    expect(r.rows.map((x) => x.status)).toEqual(['HELD', 'HELD']);
    expect(r.rows[0].issues.some((i) => i.code === 'DUPLICATE_CONFLICT')).toBe(true);
  });

  it('treats the same SKU in a different bin as a separate row', () => {
    const r = ingest(csv('Rice,Basmati,10,sacks,5,2,no,,W1,A1', 'Rice,Basmati,10,sacks,5,2,no,,W1,A2'));
    expect(r.rows.map((x) => x.status)).toEqual(['READY', 'READY']);
  });

  it('warns on near-duplicates that differ only by punctuation or spacing', () => {
    const r = ingest(csv('AB-1001 Widget,Widget,1,ea,5,2,no,,W1,A1', 'AB1001  widget,Widget,1,ea,5,2,no,,W1,A1'));
    expect(r.rows.every((x) => x.issues.some((i) => i.code === 'NEAR_DUPLICATE'))).toBe(true);
    expect(r.rows.map((x) => x.status)).toEqual(['READY', 'READY']);
  });

  it('marks rows already in the master as updates', () => {
    const r = ingest(csv('Rice,Basmati,10,sacks,5,2,no,,W1,A1', 'Wheat,Atta,10,sacks,5,2,no,,W1,A2'), { existingKeys: [keyOf('Rice', 'W1', 'A1')] });
    expect(r.rows.map((x) => x.action)).toEqual(['UPDATE', 'CREATE']);
    expect(r.summary).toMatchObject({ update: 1, create: 1 });
  });
});

describe('ingest: whole file', () => {
  it('reports missing columns once at file level and holds the rows', () => {
    const r = ingest(parseCsv('sku,qty\nRice,10'));
    expect(r.fileIssues.join(' ')).toMatch(/Description/);
    expect(r.rows[0].status).toBe('HELD');
  });

  it('lets a whole-file default fill a missing column so nothing is held', () => {
    const r = ingest(parseCsv('sku,desc,qty,ti,hi\nRice,Basmati,10,5,2\nWheat,Atta,4,6,2'), { defaults: { uom: 'Sacks', isStackable: 'no' } });
    expect(r.summary).toMatchObject({ ready: 2, held: 0 });
    expect(r.rows[0].data).toMatchObject({ uom: 'SACKS', isStackable: false });
  });

  it('copes with a BOM, quoted commas and CRLF', () => {
    const r = ingest(parseCsv('﻿sku,desc,qty,uom,ti,hi,stackable\r\n"Rice, 25kg","Basmati, long grain",10,sacks,5,2,no\r\n'));
    expect(r.rows[0].data.skuName).toBe('Rice, 25kg');
    expect(r.rows[0].status).toBe('READY');
  });

  it('returns a clear message for an empty file', () => {
    expect(ingest(parseCsv('sku,qty')).fileIssues[0]).toMatch(/No data rows/);
  });

  it('accepts JSON objects through the same path', () => {
    const r = ingest(objectsToTable([{ Material: 'M1', Description: 'Bolt', Qty: 50, UoM: 'EA', unitsPerBin: 100, Stackable: 'N' }]));
    expect(r.rows[0].status).toBe('READY');
    expect(r.rows[0].data).toMatchObject({ storageType: 'BIN', unitsPerPack: 100 });
  });
});

describe('resolveRow (exception inbox)', () => {
  it('turns a held row ready once the missing value is supplied', () => {
    const held = ingest(parseCsv('sku,desc,qty,uom,ti,hi\nRice,Basmati,10,sacks,5,2')).rows[0];
    expect(held.status).toBe('HELD');
    const fixed = resolveRow({ ...held.canon, isStackable: 'no' }, held.extras);
    expect(fixed.status).toBe('READY');
  });
});
