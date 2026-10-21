import { useMemo, useState } from 'react';
import { Badge, PageHeader } from '../../components/ui';
import { evaluateRow, type Canon, type NormalizedRow } from '../../../../shared/skuIngest';
import IngestPanel, { toItem } from './IngestPanel';
import { UOMS, WAREHOUSES, locTag, needsPackData, num, skuTagOf, useInventory, velocityMap, type Item, type Uom } from './store';

const blank = { sku: '', skuCode: '', description: '', quantity: '', uom: UOMS[0] as Uom, storageType: '', ti: '', hi: '', unitsPerPack: '', stackable: false, maxStack: '', warehouse: WAREHOUSES[0] as string, location: '', demand: '', oem: '', manufacturer: '' };
type Form = typeof blank;

const toCanon = (f: Form): Canon => ({
  skuName: f.sku, description: f.description, quantity: f.quantity, uom: f.uom, storageType: f.storageType, ti: f.ti, hi: f.hi, unitsPerPack: f.unitsPerPack,
  isStackable: f.stackable ? 'Yes' : 'No', maxStackUnits: f.stackable ? f.maxStack : '', skuCode: f.skuCode, warehouse: f.warehouse, location: f.location, weeklyDemand: f.demand, oem: f.oem, manufacturer: f.manufacturer,
});

const packLabel = (i: Item) => (i.storageType === 'PALLET' && i.ti && i.hi ? `${i.ti}×${i.hi} = ${num(i.unitsPerPack ?? i.ti * i.hi)}` : i.storageType === 'BIN' && i.unitsPerPack ? `${num(i.unitsPerPack)} / bin` : null);

export default function MasterDataPage() {
  const inv = useInventory();
  const [f, setF] = useState<Form>(blank);
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState('');
  const [q, setQ] = useState('');
  const [wh, setWh] = useState('');
  const vel = useMemo(() => velocityMap(inv.items), [inv.items]);
  const warehouses = useMemo(() => [...new Set([...WAREHOUSES, ...inv.items.map((i) => i.warehouse)])], [inv.items]);
  const rows = inv.items.filter((i) => (!wh || i.warehouse === wh) && (!q || `${i.sku} ${i.description} ${i.location}`.toLowerCase().includes(q.toLowerCase())));
  const incomplete = inv.items.filter(needsPackData).length;
  const ev = useMemo(() => evaluateRow(toCanon(f)), [f]);
  const problems = ev.issues.filter((i) => i.severity === 'ERROR');
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => ({ ...p, [k]: v }));
  const pallet = f.storageType === 'Pallet' || (!f.storageType && (f.ti !== '' || f.hi !== ''));

  function save() {
    if (!ev.ok) return;
    const existing = editing ? inv.items.find((x) => x.id === editing) : undefined;
    const row = { ...toItem(ev.data as NormalizedRow), custom: existing?.custom };
    if (editing) { inv.updateItem(editing, row); setMsg(`Updated ${row.sku}.`); } else { const r = inv.addOrUpdate([row]); setMsg(r.updated ? `${row.sku} already existed at that location, so it was updated.` : `Added ${row.sku}.`); }
    setF(blank); setEditing(null);
  }
  function edit(i: Item) {
    setEditing(i.id);
    setF({ sku: i.sku, skuCode: i.skuCode ?? '', description: i.description, quantity: String(i.quantity), uom: i.uom, storageType: i.storageType === 'PALLET' ? 'Pallet' : i.storageType === 'BIN' ? 'Bin' : '', ti: i.ti ? String(i.ti) : '', hi: i.hi ? String(i.hi) : '', unitsPerPack: i.unitsPerPack ? String(i.unitsPerPack) : '', stackable: !!i.isStackable, maxStack: i.maxStackUnits ? String(i.maxStackUnits) : '', warehouse: i.warehouse === 'Unassigned' ? '' : i.warehouse, location: i.location === 'UNASSIGNED' ? '' : i.location, demand: i.weeklyDemand === undefined ? '' : String(i.weeklyDemand), oem: i.oem ?? '', manufacturer: i.manufacturer ?? '' });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <>
      <PageHeader title="Master data" sub="SKU master and opening stock · add one at a time or bulk-load from CSV" right={<button className="btn-ghost" onClick={() => { if (confirm('Reset all inventory, counts and history to the demo data?')) inv.resetDemo(); }}>Reset demo data</button>} />
      {msg && <p className="mb-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-3 text-sm font-semibold">{editing ? 'Edit SKU' : 'Add SKU'}</h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="label">SKU name *</label><input className="input" value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="e.g. Basmati Rice 25kg" /></div>
            <div className="col-span-2"><label className="label">Description *</label><input className="input" value={f.description} onChange={(e) => set('description', e.target.value)} /></div>
            <div><label className="label">Quantity *</label><input type="number" min={0} className="input" value={f.quantity} onChange={(e) => set('quantity', e.target.value)} /></div>
            <div><label className="label">Unit of measure *</label><select className="input" value={f.uom} onChange={(e) => set('uom', e.target.value as Uom)}>{UOMS.map((u) => <option key={u}>{u}</option>)}</select></div>
            <div><label className="label">Stored as *</label><select className="input" value={f.storageType} onChange={(e) => set('storageType', e.target.value)}><option value="">Choose…</option><option>Pallet</option><option>Bin</option></select></div>
            <div><label className="label">{pallet ? 'Units per pallet *' : 'Units per bin *'}</label><input type="number" min={1} className="input" value={f.unitsPerPack} onChange={(e) => set('unitsPerPack', e.target.value)} placeholder={pallet && f.ti && f.hi ? String(Number(f.ti) * Number(f.hi)) : ''} /></div>
            {pallet && <><div><label className="label">Ti (units per layer) *</label><input type="number" min={1} className="input" value={f.ti} onChange={(e) => set('ti', e.target.value)} /></div>
              <div><label className="label">Hi (layers per pallet) *</label><input type="number" min={1} className="input" value={f.hi} onChange={(e) => set('hi', e.target.value)} /></div></>}
            <div className="flex items-end gap-2"><label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={f.stackable} onChange={(e) => set('stackable', e.target.checked)} />Stackable</label></div>
            <div><label className="label">Units allowed to stack{f.stackable ? ' *' : ''}</label><input type="number" min={1} className="input" disabled={!f.stackable} value={f.stackable ? f.maxStack : ''} onChange={(e) => set('maxStack', e.target.value)} /></div>
            <div><label className="label">Warehouse</label><select className="input" value={f.warehouse} onChange={(e) => set('warehouse', e.target.value)}><option value="">Unassigned</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></div>
            <div><label className="label">Location (bin)</label><input className="input" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="e.g. A-01-01" /></div>
            <div><label className="label">SKU code / barcode</label><input className="input font-mono" value={f.skuCode} onChange={(e) => set('skuCode', e.target.value)} placeholder="scanned tag; auto if blank" /></div>
            <div><label className="label">Weekly demand</label><input type="number" min={0} className="input" value={f.demand} onChange={(e) => set('demand', e.target.value)} placeholder="drives A/B/C velocity" /></div>
            <div><label className="label">OEM</label><input className="input" value={f.oem} onChange={(e) => set('oem', e.target.value)} /></div>
            <div><label className="label">Manufacturer</label><input className="input" value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} /></div>
          </div>
          {(f.sku || f.description || f.quantity) && problems.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-red-600">{problems.map((p, i) => <li key={i}>{p.message}</li>)}</ul>}
          {ev.issues.filter((i) => i.severity === 'WARNING').map((p, i) => <p key={i} className="mt-1 text-xs text-amber-700">{p.message}</p>)}
          <div className="mt-3 flex gap-2"><button className="btn" disabled={!ev.ok} onClick={save}>{editing ? 'Save changes' : 'Add SKU'}</button>{editing && <button className="btn-ghost" onClick={() => { setEditing(null); setF(blank); }}>Cancel</button>}</div>
          <p className="mt-2 text-xs text-slate-500">Pack data (Ti×Hi and units per pallet, or units per bin) and stackability are required so counts, putaway and slotting can trust the SKU. The SKU code is what the Zebra scans in step 2. Warehouse, location, OEM and manufacturer are optional. Re-adding the same SKU at the same location updates it rather than duplicating.</p>
        </div>

        <IngestPanel onDone={setMsg} />
      </div>

      <div className="card mt-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-sm font-semibold">SKU master <span className="font-normal text-slate-500">({rows.length} of {inv.items.length})</span></h2>
          <input className="input !w-56" placeholder="Search SKU, description, bin" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input !w-52" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All warehouses</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select>
        </div>
        {incomplete > 0 && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">{incomplete} SKU(s) are missing pack or stacking data. Edit them below, or re-import a file that includes it.</p>}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">SKU</th><th className="th">SKU tag</th><th className="th">Description</th><th className="th text-right">Quantity</th><th className="th">UoM</th><th className="th">Pack (Ti×Hi)</th><th className="th">Stacking</th><th className="th">Warehouse</th><th className="th">Location</th><th className="th" /></tr></thead>
            <tbody>
              {rows.map((i) => {
                const pack = packLabel(i); const extra = i.custom ? Object.keys(i.custom).length : 0;
                return (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className="td font-medium">{i.sku} {vel.get(i.sku) && i.weeklyDemand !== undefined && <Badge color={vel.get(i.sku) === 'A' ? 'green' : vel.get(i.sku) === 'B' ? 'blue' : 'slate'}>{vel.get(i.sku)}</Badge>}</td><td className="td font-mono text-xs">{skuTagOf(inv.items, i.sku)}</td>
                    <td className="td text-slate-500">{i.description}{i.weeklyDemand !== undefined && <span className="ml-1 text-xs text-slate-400">· {num(i.weeklyDemand)}/wk</span>}{(i.oem || i.manufacturer) && <span className="ml-1 text-xs text-slate-400">· {[i.manufacturer, i.oem && `OEM ${i.oem}`].filter(Boolean).join(', ')}</span>}{extra > 0 && <span className="ml-1" title={Object.entries(i.custom!).map(([k, v]) => `${k}: ${v}`).join('\n')}><Badge>+{extra} field{extra > 1 ? 's' : ''}</Badge></span>}</td>
                    <td className="td text-right tabular-nums">{num(i.quantity)}</td><td className="td"><Badge>{i.uom}</Badge></td>
                    <td className="td text-xs">{pack ?? <Badge color="amber">Needs pack data</Badge>}</td>
                    <td className="td text-xs">{i.isStackable === undefined ? <span className="text-slate-400">—</span> : i.isStackable ? `Up to ${i.maxStackUnits ?? '?'} high` : 'Do not stack'}</td>
                    <td className="td">{i.warehouse}</td><td className="td font-mono text-xs">{i.location} <span className="text-slate-400">({locTag(i.warehouse, i.location)})</span></td>
                    <td className="td whitespace-nowrap text-right"><button className="text-xs text-emerald-700 underline" onClick={() => edit(i)}>Edit</button> <button className="ml-2 text-xs text-red-600 underline" onClick={() => { if (confirm(`Delete ${i.sku} at ${i.location}?`)) inv.removeItem(i.id); }}>Delete</button></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td className="td text-slate-500" colSpan={10}>No SKUs match.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
