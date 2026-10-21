import { useMemo, useState } from 'react';
import { Badge, PageHeader } from '../../components/ui';
import { download as saveCsv, parseCsv } from './csv';
import { UOMS, WAREHOUSES, locTag, num, skuTagOf, useInventory, velocityMap, type Item, type Uom } from './store';

const HEAD: Record<string, string> = { sku: 'sku', skuname: 'sku', name: 'sku', description: 'description', desc: 'description', quantity: 'quantity', qty: 'quantity', uom: 'uom', unit: 'uom', unitofmeasure: 'uom', warehouse: 'warehouse', location: 'location', bin: 'location', skucode: 'skucode', barcode: 'skucode', gtin: 'skucode', weeklydemand: 'demand', demand: 'demand' };
const UOM_MAP: Record<string, Uom> = { each: 'Eaches', eaches: 'Eaches', ea: 'Eaches', pallet: 'Pallets', pallets: 'Pallets', carton: 'Cartons', cartons: 'Cartons', ctn: 'Cartons', sack: 'Sacks', sacks: 'Sacks' };
const TEMPLATE = `sku_name,sku_code,description,quantity,uom,warehouse,location,weekly_demand
Basmati Rice 25kg,8901234500011,Premium long-grain basmati 25kg bag,1840,Sacks,CWC Deesa,A-01-01,900
Groundnut Oil 15L,8901234500028,Refined groundnut oil tin 15L,310,Cartons,CWC Deesa,C-03-02,260
Mixed Grocery Pallet,,Mixed FMCG pallet,48,Pallets,CWC Ahmedabad,P-01-01,40
Pallet Wrap 500mm,,Stretch film roll,260,Eaches,Sanand Distribution Centre,D-12-02,90
`;

interface Parsed { rows: Omit<Item, 'id'>[]; errors: string[] }
function toItems(text: string): Parsed {
  const t = parseCsv(text); const errors: string[] = []; const rows: Omit<Item, 'id'>[] = [];
  if (t.length < 2) return { rows, errors: ['No data rows found. The first row must be the header.'] };
  const cols = t[0].map((h) => HEAD[h.toLowerCase().replace(/[^a-z]/g, '')]);
  if (!cols.includes('sku') || !cols.includes('quantity') || !cols.includes('uom')) return { rows, errors: ['Header must include sku_name, quantity and uom (description, warehouse and location are optional).'] };
  t.slice(1).forEach((r, i) => {
    const g = (k: string) => (r[cols.indexOf(k)] ?? '').trim();
    const uom = UOM_MAP[g('uom').toLowerCase()]; const qty = Number(g('quantity').replace(/,/g, ''));
    if (!g('sku')) return errors.push(`Row ${i + 2}: sku_name is empty`);
    if (!uom) return errors.push(`Row ${i + 2}: uom "${g('uom')}" must be Eaches, Pallets, Cartons or Sacks`);
    if (!Number.isFinite(qty) || qty < 0 || g('quantity') === '') return errors.push(`Row ${i + 2}: quantity "${g('quantity')}" is not a valid number`);
    const dem = g('demand').replace(/,/g, '');
    if (dem !== '' && (!Number.isFinite(Number(dem)) || Number(dem) < 0)) return errors.push(`Row ${i + 2}: weekly_demand "${g('demand')}" is not a valid number`);
    rows.push({ skuCode: g('skucode') || undefined, weeklyDemand: dem === '' ? undefined : Math.round(Number(dem)), sku: g('sku'), description: g('description'), quantity: Math.round(qty), uom, warehouse: g('warehouse') || 'Unassigned', location: g('location') || 'UNASSIGNED' });
  });
  return { rows, errors };
}

const blank = { sku: '', skuCode: '', description: '', quantity: '', uom: UOMS[0] as Uom, warehouse: WAREHOUSES[0], location: '', demand: '' };

export default function MasterDataPage() {
  const inv = useInventory();
  const [f, setF] = useState(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [csv, setCsv] = useState('');
  const [q, setQ] = useState('');
  const [wh, setWh] = useState('');
  const vel = useMemo(() => velocityMap(inv.items), [inv.items]);
  const parsed = useMemo(() => (csv.trim() ? toItems(csv) : null), [csv]);
  const warehouses = useMemo(() => [...new Set([...WAREHOUSES, ...inv.items.map((i) => i.warehouse)])], [inv.items]);
  const rows = inv.items.filter((i) => (!wh || i.warehouse === wh) && (!q || `${i.sku} ${i.description} ${i.location}`.toLowerCase().includes(q.toLowerCase())));
  const valid = f.sku.trim() && f.quantity !== '' && Number(f.quantity) >= 0 && Number.isFinite(Number(f.quantity));

  function save() {
    if (!valid) return;
    const row = { skuCode: f.skuCode.trim() || undefined, weeklyDemand: f.demand === '' ? undefined : Math.round(Number(f.demand)), sku: f.sku.trim(), description: f.description.trim(), quantity: Math.round(Number(f.quantity)), uom: f.uom, warehouse: f.warehouse, location: f.location.trim() || 'UNASSIGNED' };
    if (editing) { inv.updateItem(editing, row); setMsg(`Updated ${row.sku}.`); } else { const r = inv.addOrUpdate([row]); setMsg(r.updated ? `${row.sku} already existed at that location, quantity updated.` : `Added ${row.sku}.`); }
    setF(blank); setEditing(null);
  }
  function edit(i: Item) { setEditing(i.id); setF({ skuCode: i.skuCode ?? '', demand: i.weeklyDemand === undefined ? '' : String(i.weeklyDemand), sku: i.sku, description: i.description, quantity: String(i.quantity), uom: i.uom, warehouse: i.warehouse, location: i.location }); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  const download = () => saveCsv('kairad-master-data-template.csv', TEMPLATE);

  return (
    <>
      <PageHeader title="Master data" sub="SKU master and opening stock · add one at a time or bulk-load from CSV" right={<button className="btn-ghost" onClick={() => { if (confirm('Reset all inventory, counts and history to the demo data?')) inv.resetDemo(); }}>Reset demo data</button>} />
      {msg && <p className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold">{editing ? 'Edit SKU' : 'Add SKU'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">SKU name *</label><input className="input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} placeholder="e.g. Basmati Rice 25kg" /></div>
            <div className="col-span-2"><label className="label">Description</label><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
            <div><label className="label">SKU code / barcode</label><input className="input font-mono" value={f.skuCode} onChange={(e) => setF({ ...f, skuCode: e.target.value })} placeholder="scanned tag; auto if blank" /></div>
            <div><label className="label">Weekly demand (units shipped)</label><input type="number" min={0} className="input" value={f.demand} onChange={(e) => setF({ ...f, demand: e.target.value })} placeholder="drives A/B/C velocity" /></div>
            <div><label className="label">Quantity *</label><input type="number" min={0} className="input" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></div>
            <div><label className="label">Unit of measure *</label><select className="input" value={f.uom} onChange={(e) => setF({ ...f, uom: e.target.value as Uom })}>{UOMS.map((u) => <option key={u}>{u}</option>)}</select></div>
            <div><label className="label">Warehouse</label><select className="input" value={f.warehouse} onChange={(e) => setF({ ...f, warehouse: e.target.value })}>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></div>
            <div><label className="label">Location (bin)</label><input className="input" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} placeholder="e.g. A-01-01" /></div>
          </div>
          <div className="mt-3 flex gap-2"><button className="btn" disabled={!valid} onClick={save}>{editing ? 'Save changes' : 'Add SKU'}</button>{editing && <button className="btn-ghost" onClick={() => { setEditing(null); setF(blank); }}>Cancel</button>}</div>
          <p className="mt-2 text-xs text-slate-500">The SKU code is what the Zebra scans in step 2; each bin's scan tag is shown in the table. Weekly demand ranks SKUs A/B/C by velocity, which sets count frequency now and slotting and pick paths later. Warehouse and location show where stock sits. Re-adding the same SKU at the same location updates it rather than duplicating.</p>
        </div>

        <div className="card">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">Import from CSV</h2><button className="text-xs text-emerald-700 underline" onClick={download}>Download template</button></div>
          <p className="mb-2 text-xs text-slate-500">Columns: <code>sku_name, sku_code, description, quantity, uom, warehouse, location, weekly_demand</code> (sku_code, description, warehouse, location and weekly_demand are optional). uom must be Eaches, Pallets, Cartons or Sacks. Existing SKU + warehouse + location rows are updated.</p>
          <input type="file" accept=".csv,text/csv" className="mb-2 text-xs" onChange={async (e) => { const file = e.target.files?.[0]; if (file) setCsv(await file.text()); e.target.value = ''; }} />
          <textarea className="input h-28 font-mono text-xs" placeholder="…or paste CSV here" value={csv} onChange={(e) => setCsv(e.target.value)} />
          {parsed && (
            <div className="mt-2 text-sm">
              <p><b>{parsed.rows.length}</b> valid row(s){parsed.errors.length > 0 && <>, <span className="text-red-600">{parsed.errors.length} with problems</span></>}.</p>
              {parsed.errors.length > 0 && <ul className="mt-1 max-h-24 list-disc overflow-auto pl-5 text-xs text-red-600">{parsed.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
              <button className="btn mt-2" disabled={!parsed.rows.length} onClick={() => { const r = inv.addOrUpdate(parsed.rows); setMsg(`CSV imported: ${r.added} added, ${r.updated} updated${parsed.errors.length ? `, ${parsed.errors.length} skipped` : ''}.`); setCsv(''); }}>Import {parsed.rows.length} row(s)</button>
            </div>
          )}
        </div>
      </div>

      <div className="card mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold">SKU master <span className="font-normal text-slate-500">({rows.length} of {inv.items.length})</span></h2>
          <input className="input !w-56" placeholder="Search SKU, description, bin" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input !w-52" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All warehouses</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">SKU</th><th className="th">SKU tag</th><th className="th">Description</th><th className="th text-right">Quantity</th><th className="th">UoM</th><th className="th">Warehouse</th><th className="th">Location</th><th className="th" /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className="border-t border-slate-100">
                  <td className="td font-medium">{i.sku} {vel.get(i.sku) && i.weeklyDemand !== undefined && <Badge color={vel.get(i.sku) === 'A' ? 'green' : vel.get(i.sku) === 'B' ? 'blue' : 'slate'}>{vel.get(i.sku)}</Badge>}</td><td className="td font-mono text-xs">{skuTagOf(inv.items, i.sku)}</td><td className="td text-slate-500">{i.description}{i.weeklyDemand !== undefined && <span className="ml-1 text-xs text-slate-400">· {num(i.weeklyDemand)}/wk</span>}</td>
                  <td className="td text-right tabular-nums">{num(i.quantity)}</td><td className="td"><Badge>{i.uom}</Badge></td>
                  <td className="td">{i.warehouse}</td><td className="td font-mono text-xs">{i.location} <span className="text-slate-400">({locTag(i.warehouse, i.location)})</span></td>
                  <td className="td whitespace-nowrap text-right"><button className="text-xs text-emerald-700 underline" onClick={() => edit(i)}>Edit</button> <button className="ml-2 text-xs text-red-600 underline" onClick={() => { if (confirm(`Delete ${i.sku} at ${i.location}?`)) inv.removeItem(i.id); }}>Delete</button></td>
                </tr>
              ))}
              {!rows.length && <tr><td className="td text-slate-500" colSpan={7}>No SKUs match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
