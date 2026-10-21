import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '../../components/ui';
import { download, parseCsv, toCsv } from './csv';
import { locTag, routeCompare, skuTagOf, useInventory, velocityMap, type CountJob, type CountLine, type CountMethod, type Item, type ScanEvent } from './store';

type Msg = { kind: 'ok' | 'warn' | 'err'; text: string };
const MSG_TONE = { ok: 'bg-emerald-50 text-emerald-800', warn: 'bg-amber-50 text-amber-800', err: 'bg-red-50 text-red-700' };
const METHOD_LABEL: Record<CountMethod, string> = { HANDHELD: 'Zebra handheld scan', CSV: 'CSV count sheet', MANUAL: 'Manual keyboard entry' };

/** Pure scan state machine: location tag first, then SKU tags. Returns the next job state, current location and feedback. */
export function processScan(job: CountJob, items: Item[], loc: string | null, raw: string, qty: number): { job: CountJob; loc: string | null; msg: Msg } {
  const code = raw.trim(); const up = code.toUpperCase(); const t = new Date().toISOString();
  const withEvent = (j: CountJob, e: Omit<ScanEvent, 't' | 'code'>): CountJob => ({ ...j, method: 'HANDHELD', scans: [...j.scans, { t, code, ...e }] });
  const err = (text: string): ReturnType<typeof processScan> => ({ job: withEvent(job, { kind: 'ERROR', note: text }), loc, msg: { kind: 'err', text } });
  if (!code) return { job, loc, msg: { kind: 'err', text: 'Empty scan' } };

  const here = new Map<string, CountLine>(); job.lines.forEach((l) => here.set(locTag(l.warehouse, l.location).toUpperCase(), l));
  if (here.has(up)) {
    const l = here.get(up)!; const todo = job.lines.filter((x) => x.warehouse === l.warehouse && x.location === l.location && x.counted === null).length;
    return { job: withEvent(job, { kind: 'LOCATION', loc: up }), loc: up, msg: { kind: 'ok', text: `Location ${up} confirmed. Now scan the SKU tags in this bin (${todo} SKU(s) still to count).` } };
  }
  if (items.some((i) => locTag(i.warehouse, i.location).toUpperCase() === up)) return err(`${up} is a valid location but is not part of ${job.id}.`);

  const item = items.find((i) => skuTagOf(items, i.sku).toUpperCase() === up);
  if (!item) return err(`"${code}" is not a known location or SKU tag.`);
  if (!loc) return err('Scan the location tag first, then the SKU.');
  const at = here.get(loc)!;
  const idx = job.lines.findIndex((l) => l.warehouse === at.warehouse && l.location === at.location && l.sku === item.sku);
  const lines = [...job.lines];
  if (idx >= 0) {
    const next = (lines[idx].counted ?? 0) + qty; lines[idx] = { ...lines[idx], counted: next, recount: false, countedAt: t };
    return { job: withEvent({ ...job, lines }, { kind: 'SKU', loc, sku: item.sku, qty }), loc, msg: { kind: 'ok', text: `${item.sku}: +${qty} → ${next} ${item.uom.toLowerCase()}` } };
  }
  if (job.type === 'SKU' && !job.targets.includes(item.sku)) return err(`${item.sku} is not part of this SKU count.`);
  // known SKU physically present where the system says none: record as a found line (expected 0)
  lines.push({ itemId: `new:${loc}:${item.sku}`, sku: item.sku, warehouse: at.warehouse, location: at.location, uom: item.uom, expected: 0, counted: qty, extra: true, countedAt: t });
  return { job: withEvent({ ...job, lines }, { kind: 'SKU', loc, sku: item.sku, qty, note: 'found, not in system at this bin' }), loc, msg: { kind: 'warn', text: `${item.sku} is not recorded at this bin. Logged as found stock: ${qty}.` } };
}

export default function CountStep2({ job }: { job: CountJob }) {
  const inv = useInventory();
  const [tab, setTab] = useState<CountMethod>(job.method ?? 'HANDHELD');
  const done = job.lines.filter((l) => l.counted !== null).length;
  return (
    <div className="mb-3 rounded-lg border border-slate-300 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <b className="text-sm">Step 2 · Perform the count</b><span className="text-xs text-slate-500">{done}/{job.lines.length} lines counted · blind: system quantities are hidden</span>
        <div className="ml-auto flex gap-1">{(Object.keys(METHOD_LABEL) as CountMethod[]).map((m) => <button key={m} className={tab === m ? 'btn !py-1' : 'btn-ghost !py-1'} onClick={() => setTab(m)}>{METHOD_LABEL[m]}</button>)}</div>
      </div>
      {tab === 'HANDHELD' && <Handheld job={job} />}
      {tab === 'CSV' && <CsvSheet job={job} />}
      {tab === 'MANUAL' && <Manual job={job} />}
      <div className="mt-3 flex items-center gap-3 border-t border-slate-200 pt-3">
        <span className="text-xs text-slate-500">{job.lines.some((l) => l.counted === null) ? `${job.lines.filter((l) => l.counted === null).length} line(s) still uncounted. Use “Close location” on the handheld to record not-found SKUs as 0.` : 'All lines counted.'}</span>
        <button className="btn ml-auto" disabled={job.lines.some((l) => l.counted === null)} onClick={() => inv.finishCount(job.id)}>Finish count →</button>
      </div>
    </div>
  );
}

/* ───── Zebra handheld ───── */
function Handheld({ job }: { job: CountJob }) {
  const inv = useInventory();
  const [loc, setLoc] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg | null>(null);
  const [qty, setQty] = useState(1);
  const [val, setVal] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const jobRef = useRef(job); jobRef.current = job;
  useEffect(() => { ref.current?.focus(); }, [job.id]);

  const scan = (code: string) => {
    const r = processScan(jobRef.current, inv.items, loc, code, Math.max(1, qty));
    jobRef.current = r.job; inv.updateJob(job.id, () => r.job); setLoc(r.loc); setMsg(r.msg); setVal(''); ref.current?.focus();
  };
  const route = useMemo(() => {
    const m = new Map<string, { tag: string; warehouse: string; location: string; lines: CountLine[] }>();
    [...job.lines].sort(routeCompare).forEach((l) => { const tag = locTag(l.warehouse, l.location); const e = m.get(tag) ?? { tag, warehouse: l.warehouse, location: l.location, lines: [] }; e.lines.push(l); m.set(tag, e); });
    return [...m.values()];
  }, [job.lines]);
  const cur = route.find((r) => r.tag.toUpperCase() === loc);
  const scanned = cur?.lines.filter((l) => l.counted !== null) ?? [];
  const closeLoc = () => {
    if (!cur) return;
    const t = new Date().toISOString(); const n = cur.lines.filter((l) => l.counted === null).length;
    inv.updateJob(job.id, (j) => ({ ...j, method: 'HANDHELD', lines: j.lines.map((l) => (l.warehouse === cur.warehouse && l.location === cur.location && l.counted === null ? { ...l, counted: 0, recount: false, countedAt: t } : l)), scans: [...j.scans, { t, kind: 'CLOSE', code: cur.tag, loc: cur.tag, note: `${n} SKU(s) not found, recorded as 0` }] }));
    setMsg({ kind: n ? 'warn' : 'ok', text: n ? `${cur.tag} closed: ${n} SKU(s) not scanned were recorded as 0.` : `${cur.tag} closed.` }); setLoc(null); ref.current?.focus();
  };
  const log = [...job.scans].reverse().slice(0, 6);
  const t0 = job.scans.length ? new Date(job.scans[0].t).getTime() : 0;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <div className="rounded-lg border-2 border-slate-800 bg-slate-50 p-3">
          <div className="mb-2 flex items-center justify-between text-xs"><b>Zebra handheld · {job.operative}</b><span className="text-slate-500">{loc ? <>Location <b className="text-slate-800">{loc}</b></> : 'No location scanned'}</span></div>
          <div className="flex gap-2">
            <input ref={ref} className="input font-mono" placeholder={loc ? 'Scan SKU tag…' : 'Scan location tag…'} value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scan(val); } }} autoComplete="off" />
            <div className="flex items-center gap-1 text-xs text-slate-500"><label htmlFor="q">Qty/scan</label><input id="q" type="number" min={1} className="input !w-16" value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} /></div>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">A real Zebra scanner in keyboard-wedge (DataWedge) mode types the tag and presses Enter here. Use the demo scanner on the right without hardware.</p>
          {msg && <p className={`mt-2 rounded p-2 text-sm ${MSG_TONE[msg.kind]}`}>{msg.text}</p>}
          {cur && (
            <div className="mt-3">
              <table className="w-full"><thead><tr><th className="th">Scanned in this bin</th><th className="th text-right">Qty</th><th className="th">UoM</th></tr></thead>
                <tbody>{scanned.map((l) => <tr key={l.itemId} className="border-t border-slate-200"><td className="td">{l.sku} {l.extra && <Badge color="amber">Found</Badge>}{l.recount && <Badge color="amber">Recount</Badge>}</td>
                  <td className="td text-right"><input type="number" min={0} className="input !w-24 text-right" value={l.counted ?? 0} onChange={(e) => inv.updateJob(job.id, (j) => ({ ...j, method: 'HANDHELD', lines: j.lines.map((x) => (x.itemId === l.itemId ? { ...x, counted: Math.max(0, Math.round(Number(e.target.value) || 0)) } : x)) }))} /></td><td className="td text-xs">{l.uom}</td></tr>)}
                  {!scanned.length && <tr><td className="td text-slate-500" colSpan={3}>Nothing scanned yet.</td></tr>}</tbody></table>
              <div className="mt-2 flex items-center gap-3 text-sm"><span className="text-slate-500">{cur.lines.filter((l) => l.counted === null).length} SKU(s) still to scan</span><button className="btn-ghost ml-auto" onClick={closeLoc}>Close location</button></div>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 lg:col-span-2">
        <div>
          <div className="label">Suggested walk path</div>
          <div className="flex flex-wrap gap-1.5">{route.map((r, i) => { const d = r.lines.every((l) => l.counted !== null); return <span key={r.tag} className={`rounded border px-1.5 py-0.5 font-mono text-xs ${r.tag.toUpperCase() === loc ? 'border-sky-600 bg-sky-50' : d ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-slate-300'}`}>{i + 1}. {r.tag}{d ? ' ✓' : ''}</span>; })}</div>
          <p className="mt-1 text-[11px] text-slate-500">Bins are ordered by aisle and level to avoid back-tracking. The same ordering will drive pick-path sequencing.</p>
        </div>
        <details className="rounded border border-dashed border-slate-300 p-2" open>
          <summary className="cursor-pointer text-xs font-semibold">Demo scanner (no hardware)</summary>
          <div className="mt-2 text-[11px] text-slate-500">Location tags</div>
          <div className="mb-2 flex flex-wrap gap-1">{route.map((r) => <button key={r.tag} className="btn-ghost !px-1.5 !py-0.5 font-mono !text-xs" onClick={() => scan(r.tag)}>{r.tag}</button>)}</div>
          {cur && <><div className="text-[11px] text-slate-500">SKU tags expected in {cur.tag}</div>
            <div className="flex flex-wrap gap-1">{cur.lines.filter((l) => !l.extra).map((l) => <button key={l.itemId} className="btn-ghost !px-1.5 !py-0.5 !text-xs" title={l.sku} onClick={() => scan(skuTagOf(inv.items, l.sku))}>{skuTagOf(inv.items, l.sku)} <span className="ml-1 text-slate-400">{l.sku.split(' ')[0]}</span></button>)}
              <button className="btn-ghost !px-1.5 !py-0.5 !text-xs" onClick={() => scan('XX-UNKNOWN-123')}>bad tag</button></div></>}
        </details>
        <div>
          <div className="label">Scan log ({job.scans.length})</div>
          <ul className="space-y-0.5 font-mono text-[11px]">{log.map((e, i) => <li key={i} className={e.kind === 'ERROR' ? 'text-red-600' : 'text-slate-600'}>+{Math.round((new Date(e.t).getTime() - t0) / 1000)}s {e.kind} {e.code}{e.qty ? ` ×${e.qty}` : ''}</li>)}{!log.length && <li className="text-slate-400">No scans yet.</li>}</ul>
        </div>
      </div>
    </div>
  );
}

/* ───── CSV count sheet ───── */
function CsvSheet({ job }: { job: CountJob }) {
  const inv = useInventory();
  const [res, setRes] = useState<{ applied: number; blank: number; errors: string[] } | null>(null);
  const sorted = [...job.lines].sort(routeCompare);
  const sheet = () => download(`${job.id}-count-sheet.csv`, toCsv([['count_id', 'warehouse', 'location', 'location_tag', 'sku_name', 'sku_code', 'uom', 'counted_qty'], ...sorted.map((l) => [job.id, l.warehouse, l.location, locTag(l.warehouse, l.location), l.sku, skuTagOf(inv.items, l.sku), l.uom, ''])]));
  async function upload(text: string) {
    const t = parseCsv(text); const errors: string[] = []; let applied = 0, blank = 0;
    const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');
    const col = (name: string[]) => t[0]?.findIndex((h) => name.includes(norm(h))) ?? -1;
    const cTag = col(['locationtag']), cWh = col(['warehouse']), cLoc = col(['location']), cCode = col(['skucode']), cName = col(['skuname', 'sku']), cQty = col(['countedqty', 'counted', 'qty', 'quantity']);
    if (t.length < 2 || cQty < 0 || (cTag < 0 && cLoc < 0) || (cCode < 0 && cName < 0)) return setRes({ applied, blank, errors: ['Use the downloaded count sheet: it needs location (or location_tag), sku_name (or sku_code) and counted_qty columns.'] });
    const counts = new Map<number, number>();
    t.slice(1).forEach((r, i) => {
      const raw = (r[cQty] ?? '').trim(); if (raw === '') { blank++; return; }
      const n = Number(raw.replace(/,/g, '')); if (!Number.isFinite(n) || n < 0) return errors.push(`Row ${i + 2}: counted_qty "${raw}" is not a valid number`);
      const idx = job.lines.findIndex((l) =>
        (cTag >= 0 && r[cTag]?.trim() ? locTag(l.warehouse, l.location).toUpperCase() === r[cTag].trim().toUpperCase() : l.location.toUpperCase() === (r[cLoc] ?? '').trim().toUpperCase() && (cWh < 0 || !r[cWh]?.trim() || l.warehouse === r[cWh].trim())) &&
        (cCode >= 0 && r[cCode]?.trim() ? skuTagOf(inv.items, l.sku).toUpperCase() === r[cCode].trim().toUpperCase() : l.sku.toLowerCase() === (r[cName] ?? '').trim().toLowerCase()));
      if (idx < 0) return errors.push(`Row ${i + 2}: no such SKU/location in ${job.id}`);
      counts.set(idx, (counts.get(idx) ?? 0) + Math.round(n)); applied++;
    });
    if (counts.size) { const now = new Date().toISOString(); inv.updateJob(job.id, (j) => ({ ...j, method: 'CSV', lines: j.lines.map((l, i) => (counts.has(i) ? { ...l, counted: counts.get(i)!, recount: false, countedAt: now } : l)), scans: [...j.scans, { t: now, kind: 'CSV', code: 'csv-upload', qty: counts.size, note: `${counts.size} line(s) loaded from CSV` }] })); }
    setRes({ applied, blank, errors });
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-sm">1. Download the blind count sheet (bins in walk order, no system quantities), print or fill it in on the floor.</p>
        <button className="btn-ghost" onClick={sheet}>Download count sheet ({job.lines.length} lines)</button>
        <p className="mb-2 mt-4 text-sm">2. Enter <code>counted_qty</code> for each line, then upload it.</p>
        <input type="file" accept=".csv,text/csv" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f) await upload(await f.text()); e.target.value = ''; }} />
      </div>
      <div>
        {res ? <div className="text-sm"><p><b>{res.applied}</b> line(s) loaded{res.blank > 0 && <>, {res.blank} left blank</>}.</p>{res.errors.length > 0 && <ul className="mt-1 max-h-32 list-disc overflow-auto pl-5 text-xs text-red-600">{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}</div> : <p className="text-sm text-slate-500">Nothing uploaded yet. Blank counted_qty rows are skipped, so a sheet can be loaded in parts.</p>}
      </div>
    </div>
  );
}

/* ───── manual keyboard entry ───── */
function Manual({ job }: { job: CountJob }) {
  const inv = useInventory();
  const vel = useMemo(() => velocityMap(inv.items), [inv.items]);
  return (
    <div className="space-y-2">
      {[...job.lines].sort(routeCompare).map((l) => (
        <div key={l.itemId} className={`flex items-center gap-3 rounded border bg-white p-2 ${l.recount ? 'border-amber-400' : 'border-slate-200'}`}>
          <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.sku} {vel.get(l.sku) && <Badge color={vel.get(l.sku) === 'A' ? 'green' : 'slate'}>{vel.get(l.sku)}</Badge>}</div><div className="font-mono text-xs text-slate-500">{locTag(l.warehouse, l.location)}</div></div>
          {l.recount && <Badge color="amber">Recount</Badge>}
          <input type="number" min={0} className="input !w-28 text-right" placeholder="Qty" value={l.counted ?? ''} onChange={(e) => inv.updateJob(job.id, (j) => ({ ...j, method: 'MANUAL', lines: j.lines.map((x) => (x.itemId === l.itemId ? { ...x, counted: e.target.value === '' ? null : Math.max(0, Math.round(Number(e.target.value))), recount: false, countedAt: new Date().toISOString() } : x)) }))} />
          <span className="w-14 text-xs text-slate-500">{l.uom}</span>
        </div>
      ))}
    </div>
  );
}

/* ───── productivity captured from step 2 (feeds labour standards for slotting/picking later) ───── */
export function CountMetrics({ job }: { job: CountJob }) {
  const sc = job.scans.filter((s) => s.kind === 'SKU' || s.kind === 'LOCATION' || s.kind === 'ERROR');
  const first = job.scans[0]?.t ?? job.startedAt; const last = job.scans[job.scans.length - 1]?.t ?? job.finishedAt;
  const secs = first && last ? Math.max(0, (new Date(last).getTime() - new Date(first).getTime()) / 1000) : 0;
  const locs = new Set(job.scans.filter((s) => s.kind === 'LOCATION').map((s) => s.code)).size;
  const errs = job.scans.filter((s) => s.kind === 'ERROR').length;
  const fmt = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${Math.round(s)}s`);
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded bg-slate-50 p-2 text-xs text-slate-600">
      <span>Counted by <b>{job.method ? METHOD_LABEL[job.method] : '—'}</b></span>
      {sc.length > 0 && <><span>{sc.length} scans</span><span>{locs} bin(s) visited</span><span>{errs} scan error(s)</span>{secs > 0 && <span>{fmt(secs)} on task · ≈{(secs / Math.max(1, job.lines.length)).toFixed(0)} s per line</span>}</>}
      {job.scans.length > 0 && <button className="ml-auto text-emerald-700 underline" onClick={() => download(`${job.id}-scan-log.csv`, toCsv([['time', 'count_id', 'operative', 'event', 'code', 'location_tag', 'sku', 'qty', 'note'], ...job.scans.map((s) => [s.t, job.id, job.operative, s.kind, s.code, s.loc ?? '', s.sku ?? '', s.qty ?? '', s.note ?? ''])]))}>Export scan log (CSV)</button>}
    </div>
  );
}
