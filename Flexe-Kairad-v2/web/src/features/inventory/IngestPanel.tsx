import { useMemo, useState } from 'react';
import { Badge } from '../../components/ui';
import { FIELDS, FIELD_LABEL, UOM_DISPLAY, ingest, keyOf, parseCsv, resolveRow, type Canon, type Field, type IngestRow, type NormalizedRow } from '../../../../shared/skuIngest';
import { download, toCsv } from './csv';
import { useInventory, type Item, type Uom } from './store';

export const TEMPLATE = `sku_name,sku_code,description,quantity,uom,ti_x_hi,units_per_pallet_or_bin,stackable,max_stack_units,warehouse,location,weekly_demand,oem,manufacturer
Basmati Rice 25kg,8901234500011,Premium long-grain basmati 25kg bag,1840,Sacks,10x5,50,yes,3,CWC Deesa,A-01-01,900,,Daawat
Groundnut Oil 15L,8901234500028,Refined groundnut oil tin 15L,310,Cartons,8x4,32,no,,CWC Deesa,C-03-02,260,,
Pallet Wrap 500mm,,Stretch film roll,260,Eaches,,24,no,,Sanand Distribution Centre,D-12-02,90,,
`;

/** Engine output -> the platform's stock line. */
export function toItem(d: NormalizedRow): Omit<Item, 'id'> {
  return {
    sku: d.skuName, description: d.description, quantity: Math.round(d.quantity), uom: UOM_DISPLAY[d.uom] as Uom,
    warehouse: d.warehouse ?? 'Unassigned', location: d.location ?? 'UNASSIGNED',
    skuCode: d.skuCode ?? undefined, weeklyDemand: d.weeklyDemand ?? undefined,
    storageType: d.storageType, ti: d.ti ?? undefined, hi: d.hi ?? undefined, unitsPerPack: d.unitsPerPack,
    isStackable: d.isStackable, maxStackUnits: d.maxStackUnits ?? undefined,
    oem: d.oem ?? undefined, manufacturer: d.manufacturer ?? undefined,
    custom: d.customAttributes && Object.keys(d.customAttributes).length ? d.customAttributes : undefined,
  };
}

const SEV: Record<string, string> = { ERROR: 'text-red-700', WARNING: 'text-amber-700', FIXED: 'text-emerald-700' };
const SEV_MARK: Record<string, string> = { ERROR: 'Needs a fix', WARNING: 'Check', FIXED: 'Auto-fixed' };

/** Which inputs to offer for an issue's field. "packInfo" means no usable pack data at all. */
const inputsFor = (f: string): Field[] => (f === 'packInfo' ? ['storageType', 'ti', 'hi', 'unitsPerPack'] : f === 'tiHi' ? ['tiHi'] : (FIELDS as readonly string[]).includes(f) ? [f as Field] : []);

function FieldInput({ field, value, onChange }: { field: Field; value: string; onChange: (v: string) => void }) {
  const cls = 'input !py-1 text-xs';
  if (field === 'uom') return <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Unit…</option>{Object.values(UOM_DISPLAY).map((u) => <option key={u}>{u}</option>)}</select>;
  if (field === 'isStackable') return <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Stackable?</option><option>Yes</option><option>No</option></select>;
  if (field === 'storageType') return <select className={cls} value={value} onChange={(e) => onChange(e.target.value)}><option value="">Pallet or bin…</option><option>Pallet</option><option>Bin</option></select>;
  return <input className={cls} value={value} placeholder={FIELD_LABEL[field]} onChange={(e) => onChange(e.target.value)} inputMode={['quantity', 'ti', 'hi', 'unitsPerPack', 'maxStackUnits', 'weeklyDemand'].includes(field) ? 'numeric' : undefined} />;
}

export default function IngestPanel({ onDone }: { onDone: (msg: string) => void }) {
  const inv = useInventory();
  const [text, setText] = useState('');
  const [defaults, setDefaults] = useState<Canon>({});
  const [fixes, setFixes] = useState<Record<number, Canon>>({});
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [imported, setImported] = useState<Set<number>>(new Set());

  const existingKeys = useMemo(() => inv.items.map((i) => keyOf(i.sku, i.warehouse, i.location)), [inv.items]);
  const base = useMemo(() => (text.trim() ? ingest(parseCsv(text), { existingKeys, defaults }) : null), [text, existingKeys, defaults]);
  const rows: IngestRow[] = useMemo(() => (base?.rows ?? []).map((r) => {
    const f = fixes[r.rowNumber];
    if (!f || r.status === 'DROPPED') return r;
    const merged: Canon = { ...r.canon };
    for (const [k, v] of Object.entries(f)) { if (v === '') delete merged[k as Field]; else merged[k as Field] = v; }
    return { ...r, ...resolveRow(merged, r.extras, existingKeys) };
  }), [base, fixes, existingKeys]);

  const reset = () => { setFixes({}); setSkipped(new Set()); setImported(new Set()); };
  const load = (t: string) => { setText(t); setDefaults({}); reset(); };
  const live = rows.filter((r) => !skipped.has(r.rowNumber) && !imported.has(r.rowNumber));
  const ready = live.filter((r) => r.status === 'READY');
  const held = live.filter((r) => r.status === 'HELD');
  const dropped = rows.filter((r) => r.status === 'DROPPED').length;
  const valOf = (r: IngestRow, f: Field) => fixes[r.rowNumber]?.[f] ?? r.canon[f] ?? '';
  const setFix = (r: IngestRow, f: Field, v: string) => setFixes((p) => ({ ...p, [r.rowNumber]: { ...p[r.rowNumber], [f]: v } }));

  function importReady() {
    const res = inv.addOrUpdate(ready.map((r) => toItem(r.data as NormalizedRow)));
    setImported((p) => new Set([...p, ...ready.map((r) => r.rowNumber)]));
    onDone(`Imported ${res.added + res.updated} SKU(s): ${res.added} added, ${res.updated} updated.${held.length ? ` ${held.length} row(s) still held for a fix.` : ''}`);
  }
  function downloadHeld() {
    const cols = FIELDS.filter((f) => held.some((r) => r.canon[f] !== undefined));
    const out = [['row', ...cols.map((c) => FIELD_LABEL[c]), 'problems'], ...held.map((r) => [r.rowNumber, ...cols.map((c) => r.canon[c] ?? ''), r.issues.filter((i) => i.severity === 'ERROR').map((i) => i.message).join('; ')])];
    download('kairad-held-rows.csv', toCsv(out));
  }

  const missingDefaults = (base?.mapping.unmappedRequired ?? []).filter((f) => f === 'uom' || f === 'isStackable');

  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Import from CSV</h2><button className="text-xs text-emerald-700 underline" onClick={() => download('kairad-master-data-template.csv', TEMPLATE)}>Download template</button></div>
      <p className="mb-2 text-xs text-slate-500">Any column order or naming works: headers like <code>MATNR</code>, <code>Qty on hand</code> or <code>Ti x Hi</code> are matched automatically, and columns we do not know are kept as custom attributes. Every SKU needs a name, description, quantity, unit, pack data (Ti×Hi and units per pallet, or units per bin) and stackable yes/no with the units allowed to stack. Warehouse, location, OEM and manufacturer are optional.</p>
      <input type="file" accept=".csv,text/csv" className="mb-2 text-xs" onChange={async (e) => { const file = e.target.files?.[0]; if (file) load(await file.text()); e.target.value = ''; }} />
      <textarea className="input h-24 font-mono text-xs" placeholder="…or paste CSV here" value={text} onChange={(e) => load(e.target.value)} />

      {base && (
        <div className="mt-3 space-y-3 text-sm">
          {base.fileIssues.length > 0 && <ul className="list-disc rounded bg-amber-50 py-2 pl-7 pr-2 text-xs text-amber-900">{base.fileIssues.map((m, i) => <li key={i}>{m}</li>)}</ul>}

          {missingDefaults.length > 0 && (
            <div className="rounded border border-slate-200 p-2">
              <p className="mb-1 text-xs font-medium">This file has no {missingDefaults.map((f) => FIELD_LABEL[f].toLowerCase()).join(' or ')} column. Set it for every row:</p>
              <div className="flex flex-wrap gap-2">
                {missingDefaults.map((f) => <label key={f} className="text-xs"><span className="mr-1 text-slate-500">{FIELD_LABEL[f]}</span><FieldInput field={f} value={defaults[f] ?? ''} onChange={(v) => { setDefaults((p) => ({ ...p, [f]: v })); setFixes({}); }} /></label>)}
              </div>
            </div>
          )}

          <details className="rounded border border-slate-200 p-2" open={base.mapping.columns.some((c) => c.method === 'fuzzy')}>
            <summary className="cursor-pointer text-xs font-medium">How your columns were read ({base.mapping.columns.filter((c) => c.field).length} of {base.mapping.columns.length} matched)</summary>
            <table className="mt-2 w-full text-xs"><tbody>
              {base.mapping.columns.map((c) => (
                <tr key={c.index} className="border-t border-slate-100"><td className="py-1 pr-2 font-mono">{c.header || `column ${c.index + 1}`}</td><td className="pr-2">{c.field ? FIELD_LABEL[c.field] : <span className="text-slate-500">Kept as custom attribute</span>}</td><td>{c.method === 'fuzzy' ? <Badge color="amber">guessed {Math.round(c.confidence * 100)}%</Badge> : c.field ? <Badge color="green">matched</Badge> : c.method === 'collision' ? <Badge>duplicate of another column</Badge> : null}</td></tr>
              ))}
            </tbody></table>
          </details>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span><b className="text-emerald-700">{ready.length}</b> ready</span>
            <span><b className={held.length ? 'text-red-600' : ''}>{held.length}</b> held for a fix</span>
            {base.summary.autoFixed > 0 && <span><b>{base.summary.autoFixed}</b> auto-fixed</span>}
            {dropped > 0 && <span><b>{dropped}</b> exact duplicate(s) dropped</span>}
            {imported.size > 0 && <span className="text-slate-500">{imported.size} imported</span>}
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="btn" disabled={!ready.length} onClick={importReady}>Import {ready.length} ready row(s)</button>
            {held.length > 0 && <button className="btn-ghost" onClick={downloadHeld}>Download held rows (CSV)</button>}
          </div>

          {held.length > 0 && (
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Needs a fix ({held.length})</h3>
              <div className="max-h-96 space-y-2 overflow-auto pr-1">
                {held.slice(0, 50).map((r) => {
                  const fields = [...new Set(r.issues.filter((i) => i.severity === 'ERROR').flatMap((i) => inputsFor(i.field ?? '')))];
                  return (
                    <div key={r.rowNumber} className="rounded border border-red-200 bg-red-50/40 p-2">
                      <div className="flex items-center justify-between"><span className="text-xs font-medium">Row {r.rowNumber} · {r.canon.skuName || '(no name)'}</span><button className="text-xs text-slate-500 underline" onClick={() => setSkipped((p) => new Set([...p, r.rowNumber]))}>Skip row</button></div>
                      <ul className="mt-1 text-xs">{r.issues.filter((i) => i.severity !== 'FIXED').map((i, k) => <li key={k} className={SEV[i.severity]}><b>{SEV_MARK[i.severity]}:</b> {i.message}{i.suggestion ? <span className="text-slate-500"> ({i.suggestion})</span> : null}</li>)}</ul>
                      {fields.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{fields.map((f) => <FieldInput key={f} field={f} value={valOf(r, f)} onChange={(v) => setFix(r, f, v)} />)}</div>}
                    </div>
                  );
                })}
                {held.length > 50 && <p className="text-xs text-slate-500">Showing the first 50 of {held.length}. Fix these, or download the held rows and correct them at source.</p>}
              </div>
            </div>
          )}

          {ready.some((r) => r.issues.some((i) => i.severity !== 'FIXED')) && (
            <details className="text-xs"><summary className="cursor-pointer font-medium">Ready rows with something to check ({ready.filter((r) => r.issues.some((i) => i.severity !== 'FIXED')).length})</summary>
              <ul className="mt-1 list-disc pl-5 text-amber-800">{ready.filter((r) => r.issues.some((i) => i.severity !== 'FIXED')).slice(0, 30).map((r) => <li key={r.rowNumber}>Row {r.rowNumber}: {r.issues.filter((i) => i.severity !== 'FIXED').map((i) => i.message).join('; ')}</li>)}</ul></details>
          )}
        </div>
      )}
    </div>
  );
}
