import { useMemo, useState } from 'react';
import { Badge, PageHeader } from '../../components/ui';
import CountStep2, { CountMetrics } from './CountStep2';
import { OPERATIVES, STAGES, accuracy, DUE_DAYS, routeCompare, velocityMap, fmtDate, fmtPct, locKey, locLabel, num, useInventory, type CountJob, type CountLine } from './store';

type Tab = 'workflow' | 'location' | 'sku';
const STAGE_TONE = ['bg-slate-500', 'bg-sky-600', 'bg-amber-500', 'bg-violet-600', 'bg-emerald-700'];
const diffOf = (l: CountLine) => (l.counted ?? l.expected) - l.expected;
const DiffCell = ({ d }: { d: number }) => <span className={d === 0 ? 'text-slate-400' : d > 0 ? 'font-semibold text-sky-700' : 'font-semibold text-red-600'}>{d > 0 ? '+' : ''}{num(d)}</span>;

export default function CycleCountsPage() {
  const inv = useInventory();
  const [tab, setTab] = useState<Tab>('workflow');
  const [selId, setSelId] = useState<string | null>(null);
  const [form, setForm] = useState<{ type: 'LOCATION' | 'SKU'; targets: string[] } | null>(null);
  const sel = inv.jobs.find((j) => j.id === selId) ?? null;
  const open = (type: 'LOCATION' | 'SKU', targets: string[]) => { setForm({ type, targets }); setTab('workflow'); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  return (
    <>
      <PageHeader title="Cycle counts" sub="Request → count on handheld → tally → inventory control approval → stock adjusted" right={<button className="btn" onClick={() => setForm({ type: 'LOCATION', targets: [] })}>+ Request a count</button>} />
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {([['workflow', 'Count workflow'], ['location', 'Location based'], ['sku', 'SKU based']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === k ? 'border-emerald-700 font-semibold text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{l}</button>
        ))}
      </div>
      {tab === 'workflow' && (
        <>
          {form && <RequestForm initial={form} onClose={() => setForm(null)} onCreated={(id) => { setSelId(id); setForm(null); }} />}
          <div className="grid gap-3 lg:grid-cols-5">
            {STAGES.map((name, i) => {
              const jobs = inv.jobs.filter((j) => j.stage === i + 1).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)).slice(0, i === 4 ? 5 : 50);
              const total = inv.jobs.filter((j) => j.stage === i + 1).length;
              return (
                <div key={name} className="rounded-lg bg-slate-100 p-2">
                  <div className="mb-2 flex items-center gap-2 px-1"><span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold text-white ${STAGE_TONE[i]}`}>{i + 1}</span><span className="text-xs font-semibold leading-tight">{name}</span><span className="ml-auto text-xs text-slate-500">{total}</span></div>
                  <div className="space-y-2">
                    {jobs.map((j) => (
                      <button key={j.id} onClick={() => setSelId(j.id)} className={`block w-full rounded-md border bg-white p-2 text-left text-xs shadow-sm hover:border-emerald-600 ${selId === j.id ? 'border-emerald-600 ring-1 ring-emerald-600' : 'border-slate-200'}`}>
                        <div className="flex items-center justify-between"><b>{j.id}</b>{j.priority === 'High' && <Badge color="red">High</Badge>}</div>
                        <div className="mt-1 text-slate-600">{j.type === 'LOCATION' ? `${j.targets.length} location(s)` : `${j.targets.length} SKU(s)`} · {j.lines.length} lines</div>
                        <div className="truncate text-slate-500">{j.type === 'LOCATION' ? j.targets.map(locLabel).join(', ') : j.targets.join(', ')}</div>
                        <div className="mt-1 text-slate-400">{j.operative} · {fmtDate(j.requestedAt)}</div>
                      </button>
                    ))}
                    {!jobs.length && <p className="px-1 py-3 text-center text-xs text-slate-400">None</p>}
                  </div>
                </div>
              );
            })}
          </div>
          {sel ? <JobPanel job={sel} /> : <p className="mt-4 text-sm text-slate-500">Select a count above to work it, or request a new one.</p>}
        </>
      )}
      {tab === 'location' && <LocationTab onRequest={(k) => open('LOCATION', [k])} />}
      {tab === 'sku' && <SkuTab onRequest={(s) => open('SKU', [s])} />}
    </>
  );
}

/* ───── 1. request ───── */
function RequestForm({ initial, onClose, onCreated }: { initial: { type: 'LOCATION' | 'SKU'; targets: string[] }; onClose: () => void; onCreated: (id: string) => void }) {
  const inv = useInventory();
  const [type, setType] = useState(initial.type);
  const [targets, setTargets] = useState<string[]>(initial.targets);
  const [operative, setOperative] = useState(OPERATIVES[0]);
  const [priority, setPriority] = useState<'Normal' | 'High'>('Normal');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const set = type === 'LOCATION' ? [...new Set(inv.items.map((i) => locKey(i.warehouse, i.location)))] : [...new Set(inv.items.map((i) => i.sku))];
    return set.sort().filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  }, [inv.items, type, q]);
  const toggle = (o: string) => setTargets((t) => (t.includes(o) ? t.filter((x) => x !== o) : [...t, o]));
  return (
    <div className="card mb-4">
      <div className="mb-3 flex items-center"><h2 className="text-sm font-semibold">Step 1 · Request a cycle count</h2><button className="ml-auto text-xs text-slate-500 underline" onClick={onClose}>Close</button></div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div>
          <label className="label">Count by</label>
          <div className="mb-3 flex gap-2">{(['LOCATION', 'SKU'] as const).map((t) => <button key={t} className={type === t ? 'btn' : 'btn-ghost'} onClick={() => { setType(t); setTargets([]); }}>{t === 'LOCATION' ? 'Locations' : 'SKUs'}</button>)}</div>
          <label className="label">Assign to field operative</label>
          <select className="input mb-3" value={operative} onChange={(e) => setOperative(e.target.value)}>{OPERATIVES.map((o) => <option key={o}>{o}</option>)}</select>
          <label className="label">Priority</label>
          <select className="input mb-3" value={priority} onChange={(e) => setPriority(e.target.value as 'Normal' | 'High')}><option>Normal</option><option>High</option></select>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. suspected mis-pick" />
        </div>
        <div className="lg:col-span-2">
          <div className="mb-1 flex items-center justify-between"><label className="label !mb-0">Select {type === 'LOCATION' ? 'locations' : 'SKUs'} ({targets.length} chosen)</label><input className="input !w-48" placeholder="Filter" value={q} onChange={(e) => setQ(e.target.value)} /></div>
          <div className="grid max-h-56 gap-1 overflow-auto rounded-md border border-slate-200 p-2 sm:grid-cols-2">
            {options.map((o) => <label key={o} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={targets.includes(o)} onChange={() => toggle(o)} />{type === 'LOCATION' ? locLabel(o) : o}</label>)}
            {!options.length && <p className="text-sm text-slate-500">Nothing matches.</p>}
          </div>
          <button className="btn mt-3" disabled={!targets.length} onClick={() => onCreated(inv.requestCount({ type, targets, operative, priority, note: note || undefined }))}>Create count request</button>
        </div>
      </div>
    </div>
  );
}

/* ───── 2–5. job detail ───── */
function JobPanel({ job }: { job: CountJob }) {
  const inv = useInventory();
  const [by, setBy] = useState('Inventory Control Manager');
  const [rej, setRej] = useState('');
  const varLines = job.lines.filter((l) => diffOf(l) !== 0);
  const showExpected = job.stage >= 3; // blind count until the operative has finished
  return (
    <div className="card mt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold">{job.id}</h2><Badge color={job.stage === 5 ? 'green' : job.stage === 4 ? 'blue' : 'amber'}>Step {job.stage} · {STAGES[job.stage - 1]}</Badge>
        {job.priority === 'High' && <Badge color="red">High priority</Badge>}
        <span className="text-xs text-slate-500">{job.type === 'LOCATION' ? 'By location' : 'By SKU'} · {job.operative} · requested {fmtDate(job.requestedAt)}{job.note ? ` · “${job.note}”` : ''}</span>
      </div>
      {job.rejectedNote && job.stage === 2 && <p className="mb-3 rounded bg-amber-50 p-2 text-sm text-amber-800">Returned for recount: {job.rejectedNote}</p>}

      {job.stage === 1 && <div className="mb-3 flex items-center gap-3 rounded bg-slate-50 p-3 text-sm"><span>Waiting to be released to {job.operative}'s handheld. Expected quantities stay hidden from the operative (blind count).</span><button className="btn ml-auto" onClick={() => inv.startCount(job.id)}>Release to handheld →</button></div>}

      {job.stage === 2 && <CountStep2 job={job} />}

      {job.stage >= 3 && <CountMetrics job={job} />}
      {job.stage >= 3 && (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead><tr><th className="th">SKU</th><th className="th">Warehouse · location</th><th className="th text-right">System</th><th className="th text-right">Counted</th><th className="th text-right">Variance</th><th className="th text-right">%</th><th className="th">UoM</th>{job.stage === 3 && <th className="th" />}</tr></thead>
            <tbody>
              {[...job.lines].sort(routeCompare).map((l) => { const d = diffOf(l); return (
                <tr key={l.itemId} className="border-t border-slate-100">
                  <td className="td font-medium">{l.sku} {l.extra && <Badge color="amber">Found · not in system</Badge>}</td><td className="td text-xs text-slate-600">{l.warehouse} · {l.location}</td>
                  <td className="td text-right tabular-nums">{num(l.expected)}</td><td className="td text-right tabular-nums">{num(l.counted ?? 0)}</td>
                  <td className="td text-right tabular-nums"><DiffCell d={d} /></td><td className="td text-right text-xs text-slate-500">{l.expected ? ((d / l.expected) * 100).toFixed(1) + '%' : '—'}</td><td className="td text-xs">{l.uom}</td>
                  {job.stage === 3 && <td className="td text-right">{d !== 0 && <button className="text-xs text-emerald-700 underline" onClick={() => inv.recountLine(job.id, l.itemId)}>Recount</button>}</td>}
                </tr>); })}
            </tbody>
          </table>
        </div>
      )}

      {job.stage === 3 && (
        <div className="mt-3 flex items-center gap-3 rounded bg-slate-50 p-3 text-sm">
          <span>Tally: <b>{varLines.length}</b> of {job.lines.length} lines have a variance. Recount any you doubt, then send the rest for approval.</span>
          <button className="btn ml-auto" onClick={() => inv.sendForApproval(job.id)}>Send for approval →</button>
        </div>
      )}
      {job.stage === 4 && (
        <div className="mt-3 rounded bg-violet-50 p-3 text-sm">
          <p className="mb-2"><b>Inventory Control Manager approval.</b> Approving writes {varLines.length} stock adjustment(s) to the system quantity and records them in the count history.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div><label className="label">Approver</label><input className="input !w-56" value={by} onChange={(e) => setBy(e.target.value)} /></div>
            <button className="btn" disabled={!by.trim()} onClick={() => inv.approve(job.id, by.trim())}>Approve &amp; adjust stock</button>
            <div className="ml-4"><label className="label">Reject reason</label><input className="input !w-64" value={rej} onChange={(e) => setRej(e.target.value)} placeholder="optional" /></div>
            <button className="btn-ghost" onClick={() => inv.reject(job.id, rej)}>Reject → recount</button>
          </div>
        </div>
      )}
      {job.stage === 5 && <p className="mt-3 rounded bg-emerald-50 p-2 text-sm text-emerald-800">Approved by {job.approvedBy} on {fmtDate(job.completedAt)}. {varLines.length ? `${varLines.length} adjustment(s) applied to stock.` : 'No adjustments were needed.'}</p>}
      {job.stage === 1 && <ul className="mt-2 text-sm text-slate-600">{job.lines.map((l) => <li key={l.itemId}>• {l.sku} — {l.warehouse} · {l.location}</li>)}</ul>}
    </div>
  );
}

/* ───── tabs ───── */
function useOpenCounts() {
  const { jobs } = useInventory();
  return (pred: (l: CountLine) => boolean) => jobs.find((j) => j.stage < 5 && j.lines.some(pred))?.id;
}

function LocationTab({ onRequest }: { onRequest: (key: string) => void }) {
  const { items, history } = useInventory();
  const openIn = useOpenCounts();
  const [wh, setWh] = useState('');
  const vmap = useMemo(() => velocityMap(items), [items]);
  const rows = useMemo(() => {
    const keys = [...new Set(items.map((i) => locKey(i.warehouse, i.location)))];
    return keys.map((k) => {
      const [warehouse, location] = k.split('|');
      const here = items.filter((i) => i.warehouse === warehouse && i.location === location);
      const h = history.filter((e) => e.warehouse === warehouse && e.location === location).sort((a, b) => a.date.localeCompare(b.date));
      const last = h[h.length - 1];
      const lastBatch = last ? h.filter((e) => e.countId === last.countId) : [];
      const rank = { A: 0, B: 1, C: 2 } as const;
      const vel = here.map((i) => vmap.get(i.sku) ?? 'C').sort((a, b) => rank[a] - rank[b])[0] ?? 'C';
      return { k, warehouse, location, vel, skus: here.length, onHand: [...new Set(here.map((i) => i.uom))].map((u) => `${num(here.filter((i) => i.uom === u).reduce((s, i) => s + i.quantity, 0))} ${u.toLowerCase()}`).join(' · '), last: last?.date, variance: lastBatch.reduce((s, e) => s + Math.abs(e.counted - e.expected), 0), adj: h.filter((e) => e.adjusted).length, acc: accuracy(h).qty, counts: new Set(h.map((e) => e.countId)).size, open: openIn((l) => l.warehouse === warehouse && l.location === location) };
    }).filter((r) => !wh || r.warehouse === wh).sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''));
  }, [items, history, wh, openIn, vmap]);
  const stale = (d: string | undefined, v: 'A' | 'B' | 'C') => !d || Date.now() - new Date(d).getTime() > DUE_DAYS[v] * 86_400_000;
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2"><h2 className="mr-auto text-sm font-semibold">Location-based count status <span className="font-normal text-slate-500">· longest since counted first</span></h2>
        <select className="input !w-52" value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All warehouses</option>{[...new Set(items.map((i) => i.warehouse))].map((w) => <option key={w}>{w}</option>)}</select></div>
      <div className="overflow-x-auto"><table className="w-full">
        <thead><tr><th className="th">Warehouse</th><th className="th">Location</th><th className="th text-right">SKUs</th><th className="th">Fastest SKU</th><th className="th">On hand</th><th className="th">Last counted</th><th className="th text-right">Last variance (abs units)</th><th className="th text-right">Adjustments</th><th className="th text-right">Line accuracy</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.k} className="border-t border-slate-100">
            <td className="td">{r.warehouse}</td><td className="td font-mono text-xs">{r.location}</td><td className="td text-right">{r.skus}</td><td className="td"><Badge color={r.vel === 'A' ? 'green' : 'slate'}>{r.vel}</Badge></td><td className="td text-xs text-slate-600">{r.onHand}</td>
            <td className="td">{fmtDate(r.last)}</td><td className="td text-right tabular-nums">{r.last ? (r.variance ? num(r.variance) : <span className="text-slate-400">0</span>) : '—'}</td><td className="td text-right">{r.adj}</td>
            <td className="td text-right tabular-nums">{r.counts ? fmtPct(r.acc) : '—'}</td>
            <td className="td">{r.open ? <Badge color="blue">In count {r.open}</Badge> : stale(r.last, r.vel) ? <Badge color="amber">Count due</Badge> : <Badge color="green">Up to date</Badge>}</td>
            <td className="td text-right">{!r.open && <button className="text-xs text-emerald-700 underline" onClick={() => onRequest(r.k)}>Request count</button>}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}

function SkuTab({ onRequest }: { onRequest: (sku: string) => void }) {
  const { items, history } = useInventory();
  const openIn = useOpenCounts();
  const [q, setQ] = useState('');
  const vmap = useMemo(() => velocityMap(items), [items]);
  const rows = useMemo(() => {
    return [...new Set(items.map((i) => i.sku))].filter((s) => s.toLowerCase().includes(q.toLowerCase())).map((sku) => {
      const mine = items.filter((i) => i.sku === sku);
      const h = history.filter((e) => e.sku === sku).sort((a, b) => a.date.localeCompare(b.date));
      const last = h[h.length - 1];
      const lastBatch = last ? h.filter((e) => e.countId === last.countId) : [];
      return { sku, vel: vmap.get(sku) ?? 'C', demand: mine[0].weeklyDemand, desc: mine[0].description, locs: mine.length, whs: new Set(mine.map((i) => i.warehouse)).size, qty: `${num(mine.reduce((s, i) => s + i.quantity, 0))} ${mine[0].uom.toLowerCase()}`, last: last?.date, net: lastBatch.reduce((s, e) => s + e.counted - e.expected, 0), adj: h.filter((e) => e.adjusted).length, acc: accuracy(h).qty, counts: new Set(h.map((e) => e.countId)).size, open: openIn((l) => l.sku === sku) };
    }).sort((a, b) => (a.last ?? '').localeCompare(b.last ?? ''));
  }, [items, history, q, openIn, vmap]);
  const stale = (d: string | undefined, v: 'A' | 'B' | 'C') => !d || Date.now() - new Date(d).getTime() > DUE_DAYS[v] * 86_400_000;
  return (
    <div className="card">
      <div className="mb-3 flex items-center gap-2"><h2 className="mr-auto text-sm font-semibold">SKU-based count status <span className="font-normal text-slate-500">· A-class SKUs are due every 7 days, B 14, C 30</span></h2><input className="input !w-56" placeholder="Search SKU" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="overflow-x-auto"><table className="w-full">
        <thead><tr><th className="th">SKU</th><th className="th">Velocity</th><th className="th text-right">Weekly demand</th><th className="th text-right">Locations</th><th className="th text-right">Warehouses</th><th className="th text-right">System qty</th><th className="th">Last counted</th><th className="th text-right">Net variance last count</th><th className="th text-right">Adjustments</th><th className="th text-right">Line accuracy</th><th className="th">Status</th><th className="th" /></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.sku} className="border-t border-slate-100">
            <td className="td"><div className="font-medium">{r.sku}</div><div className="text-xs text-slate-500">{r.desc}</div></td>
            <td className="td"><Badge color={r.vel === 'A' ? 'green' : r.vel === 'B' ? 'blue' : 'slate'}>{r.vel}</Badge></td><td className="td text-right tabular-nums">{r.demand ? num(r.demand) : '—'}</td><td className="td text-right">{r.locs}</td><td className="td text-right">{r.whs}</td><td className="td text-right tabular-nums">{r.qty}</td><td className="td">{fmtDate(r.last)}</td>
            <td className="td text-right tabular-nums">{r.last ? <DiffCell d={r.net} /> : '—'}</td><td className="td text-right">{r.adj}</td><td className="td text-right tabular-nums">{r.counts ? fmtPct(r.acc) : '—'}</td>
            <td className="td">{r.open ? <Badge color="blue">In count {r.open}</Badge> : stale(r.last, r.vel) ? <Badge color="amber">Count due</Badge> : <Badge color="green">Up to date</Badge>}</td>
            <td className="td text-right">{!r.open && <button className="text-xs text-emerald-700 underline" onClick={() => onRequest(r.sku)}>Request count</button>}</td>
          </tr>))}</tbody>
      </table></div>
    </div>
  );
}
