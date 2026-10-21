import { useEffect, useMemo, useState } from 'react';
import { Bar as RBar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, PageHeader, Stat } from '../../components/ui';
import { UOMS, accuracy, fmtDate, fmtPct, num, useInventory, type HistoryEntry } from './store';

const UOM_COLOR = ['#0369a1', '#047857', '#b45309', '#7c3aed'];
const tone = (v: number | null) => (v === null ? undefined : v < 0.9 ? 'bad' : v < 0.95 ? 'warn' : undefined);

export default function InventoryControlPage() {
  const { items, jobs, history } = useInventory();
  const [wh, setWh] = useState('');
  const [q, setQ] = useState('');
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 5_000); return () => clearInterval(t); }, []);
  useEffect(() => setNow(new Date()), [items, history, jobs]);

  const warehouses = useMemo(() => [...new Set(items.map((i) => i.warehouse))].sort(), [items]);
  const hist = useMemo(() => (wh ? history.filter((h) => h.warehouse === wh) : history), [history, wh]);
  const acc = useMemo(() => accuracy(hist), [hist]);
  const stock = items.filter((i) => (!wh || i.warehouse === wh) && (!q || `${i.sku} ${i.location}`.toLowerCase().includes(q.toLowerCase())));
  const adjustments = useMemo(() => hist.filter((h) => h.adjusted).sort((a, b) => b.date.localeCompare(a.date)), [hist]);
  const since = Date.now() - 30 * 86_400_000;
  const adj30 = adjustments.filter((a) => new Date(a.date).getTime() >= since);
  const open = jobs.filter((j) => j.stage < 5);
  const lastCount = useMemo(() => { const m = new Map<string, HistoryEntry>(); for (const h of history) { const k = `${h.sku}|${h.warehouse}|${h.location}`; const p = m.get(k); if (!p || p.date <= h.date) m.set(k, h); } return m; }, [history]);

  const byWh = useMemo(() => warehouses.map((w) => {
    const row: Record<string, string | number> = { warehouse: w };
    UOMS.forEach((u) => { row[u] = items.filter((i) => i.warehouse === w && i.uom === u).reduce((s, i) => s + i.quantity, 0); });
    return row;
  }), [warehouses, items]);

  const trend = useMemo(() => {
    const g = new Map<string, HistoryEntry[]>(); for (const h of hist) g.set(h.countId, [...(g.get(h.countId) ?? []), h]);
    return [...g.entries()].map(([id, es]) => {
      const sku = new Map<string, boolean>(); es.forEach((e) => sku.set(e.sku, (sku.get(e.sku) ?? true) && e.counted === e.expected));
      return { date: es[0].date, label: fmtDate(es[0].date), id, qty: +(es.reduce((s, e) => s + (e.expected ? Math.max(0, 1 - Math.abs(e.counted - e.expected) / e.expected) : 1), 0) / es.length * 100).toFixed(1), sku: +(([...sku.values()].filter(Boolean).length / sku.size) * 100).toFixed(1) };
    }).sort((a, b) => a.date.localeCompare(b.date));
  }, [hist]);

  const perWh = warehouses.map((w) => ({ w, a: accuracy(history.filter((h) => h.warehouse === w)), skus: new Set(items.filter((i) => i.warehouse === w).map((i) => i.sku)).size }));

  return (
    <>
      <PageHeader title="Inventory control" sub="Stock on hand by warehouse and cycle-count accuracy" right={
        <div className="flex items-center gap-3"><span className="flex items-center gap-1.5 text-xs text-slate-500"><i className="inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-500" />Live · {now.toLocaleTimeString('en-IN')}</span>
          <select className="input !w-52" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All warehouses</option>{warehouses.map((w) => <option key={w}>{w}</option>)}</select></div>} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Inventory accuracy" value={fmtPct(acc.qty)} sub="Avg. line accuracy, latest count of each SKU/bin" tone={tone(acc.qty)} />
        <Stat label="SKU accuracy" value={fmtPct(acc.sku)} sub="SKUs with zero variance on latest count" tone={tone(acc.sku)} />
        <Stat label="Location accuracy" value={fmtPct(acc.loc)} sub="Bins with zero variance on latest count" tone={tone(acc.loc)} />
        <Stat label="Adjustments · 30 days" value={adj30.length} sub={`${adjustments.length} all time · across ${acc.lines} counted lines`} tone={adj30.length > 8 ? 'warn' : undefined} />
        <Stat label="Counts open" value={open.length} sub={`${open.filter((j) => j.stage === 4).length} awaiting manager approval`} tone={open.some((j) => j.stage === 4) ? 'warn' : undefined} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-1 text-sm font-semibold">Stock by warehouse</h2><p className="mb-2 text-xs text-slate-500">Quantities stay in their own unit of measure, so they are stacked rather than added together.</p>
          <div className="h-64"><ResponsiveContainer><BarChart data={byWh}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="warehouse" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => num(v)} /><Tooltip formatter={(v: number) => num(v)} /><Legend />{UOMS.map((u, i) => <RBar key={u} dataKey={u} stackId="a" fill={UOM_COLOR[i]} />)}</BarChart></ResponsiveContainer></div>
        </div>
        <div className="card">
          <h2 className="mb-1 text-sm font-semibold">Accuracy by count</h2><p className="mb-2 text-xs text-slate-500">Each point is one approved cycle count; updates the moment a count is approved.</p>
          <div className="h-64"><ResponsiveContainer><LineChart data={trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis domain={[60, 100]} tick={{ fontSize: 11 }} unit="%" /><Tooltip labelFormatter={(_, p) => p?.[0]?.payload?.id ?? ''} formatter={(v: number) => v + '%'} /><Legend /><Line type="monotone" dataKey="qty" name="Inventory accuracy" stroke="#047857" strokeWidth={2} dot /><Line type="monotone" dataKey="sku" name="SKU accuracy" stroke="#0369a1" strokeWidth={2} dot /></LineChart></ResponsiveContainer></div>
        </div>
      </div>

      <div className="card mt-4">
        <h2 className="mb-2 text-sm font-semibold">Accuracy by warehouse</h2>
        <table className="w-full"><thead><tr><th className="th">Warehouse</th><th className="th text-right">SKUs</th><th className="th text-right">Inventory</th><th className="th text-right">SKU</th><th className="th text-right">Location</th></tr></thead>
          <tbody>{perWh.map(({ w, a, skus }) => <tr key={w} className="border-t border-slate-100"><td className="td font-medium">{w}</td><td className="td text-right">{skus}</td><td className="td text-right tabular-nums">{fmtPct(a.qty)}</td><td className="td text-right tabular-nums">{fmtPct(a.sku)}</td><td className="td text-right tabular-nums">{fmtPct(a.loc)}</td></tr>)}</tbody></table>
      </div>

      <div className="card mt-4">
        <h2 className="mb-2 text-sm font-semibold">Adjustments from cycle counts <span className="font-normal text-slate-500">· what changed and by how much</span></h2>
        <div className="max-h-80 overflow-auto"><table className="w-full">
          <thead><tr><th className="th">Date</th><th className="th">Count</th><th className="th">SKU</th><th className="th">Warehouse · location</th><th className="th text-right">Previous</th><th className="th text-right">Counted</th><th className="th text-right">Difference</th><th className="th">Approved by</th></tr></thead>
          <tbody>{adjustments.slice(0, 40).map((a) => { const d = a.counted - a.expected; return (
            <tr key={a.id} className="border-t border-slate-100"><td className="td">{fmtDate(a.date)}</td><td className="td font-mono text-xs">{a.countId}</td><td className="td font-medium">{a.sku}</td><td className="td text-xs">{a.warehouse} · {a.location}</td>
              <td className="td text-right tabular-nums">{num(a.expected)}</td><td className="td text-right tabular-nums">{num(a.counted)}</td>
              <td className={`td text-right font-semibold tabular-nums ${d < 0 ? 'text-red-600' : 'text-sky-700'}`}>{d > 0 ? '+' : ''}{num(d)} <span className="font-normal text-slate-400">{a.uom.toLowerCase()} ({((d / a.expected) * 100).toFixed(1)}%)</span></td><td className="td text-xs">{a.approvedBy}</td></tr>); })}
            {!adjustments.length && <tr><td className="td text-slate-500" colSpan={8}>No adjustments recorded.</td></tr>}</tbody>
        </table></div>
      </div>

      <div className="card mt-4">
        <div className="mb-3 flex items-center gap-2"><h2 className="mr-auto text-sm font-semibold">Stock on hand <span className="font-normal text-slate-500">({stock.length} lines)</span></h2><input className="input !w-56" placeholder="Search SKU or bin" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="max-h-[28rem] overflow-auto"><table className="w-full">
          <thead className="sticky top-0 bg-white"><tr><th className="th">SKU</th><th className="th">Warehouse</th><th className="th">Location</th><th className="th text-right">Quantity</th><th className="th">UoM</th><th className="th">Last counted</th><th className="th">Last result</th></tr></thead>
          <tbody>{stock.map((i) => { const l = lastCount.get(`${i.sku}|${i.warehouse}|${i.location}`); const d = l ? l.counted - l.expected : 0; return (
            <tr key={i.id} className="border-t border-slate-100"><td className="td font-medium">{i.sku}</td><td className="td">{i.warehouse}</td><td className="td font-mono text-xs">{i.location}</td><td className="td text-right tabular-nums">{num(i.quantity)}</td><td className="td text-xs">{i.uom}</td>
              <td className="td">{fmtDate(l?.date)}</td><td className="td">{!l ? <Badge>Never counted</Badge> : d === 0 ? <Badge color="green">Matched</Badge> : <Badge color={d < 0 ? 'red' : 'blue'}>{d > 0 ? '+' : ''}{num(d)} adjusted</Badge>}</td></tr>); })}</tbody>
        </table></div>
      </div>
    </>
  );
}
