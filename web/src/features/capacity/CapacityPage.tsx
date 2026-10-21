import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, inr, useGet, type RankResult } from '../../api/client';
import { Badge, PageHeader, ScoreBreakdown } from '../../components/ui';
import BookingsTable from './BookingsTable';
import CapacityUploadWizard from './CapacityUploadWizard';

export default function CapacityPage() {
  const qc = useQueryClient();
  const [f, setF] = useState({ lat: 24.26, lng: 72.19, pallets: 800, start: '2027-03-01', end: '2027-06-01', cold: true, minTier: 'VERIFIED' });
  const [w, setW] = useState({ cost: 40, lead: 30, reliability: 20, fit: 10 });
  const [res, setRes] = useState<RankResult | null>(null);
  const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'market' | 'upload' | 'bookings'>('market');

  async function rank() {
    setBusy(true); setMsg('');
    try {
      setRes(await api<RankResult>('/capacity/rank', { body: { originLat: f.lat, originLng: f.lng, commodity: 'potato', pallets: f.pallets, start: f.start, end: f.end, needCold: f.cold, minTier: f.minTier, weights: w } }));
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function book(lines: { slotId: string; pallets: number }[]) {
    try {
      const b = await api<{ ref: string; totalCost: number }>('/bookings', { body: { commodity: 'potato', start: f.start, end: f.end, lines } });
      setMsg(`Held ${b.ref} — ${inr(b.totalCost)} (24 h hold; confirm in Bookings)`);
      qc.invalidateQueries({ queryKey: ['bookings'] }); rank();
    } catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <PageHeader title="3PL capacity aggregator" sub="Transaction-based marketplace: lock external pallet spaces for the seasonal surge"
        right={<div className="flex gap-1">{(['market', 'upload', 'bookings'] as const).map((t) => <button key={t} className={t === tab ? 'btn' : 'btn-ghost'} onClick={() => setTab(t)}>{{ market: 'Find & book', upload: 'Provider upload', bookings: 'Bookings' }[t]}</button>)}</div>} />
      {tab === 'upload' && <CapacityUploadWizard />}
      {tab === 'bookings' && <BookingsTable />}
      {tab === 'market' && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="card space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2"><label className="label">Pallets needed</label><input type="number" className="input" value={f.pallets} onChange={(e) => setF({ ...f, pallets: +e.target.value })} /></div>
              <div><label className="label">From</label><input type="date" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
              <div><label className="label">To</label><input type="date" className="input" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
              <div><label className="label">Origin lat</label><input type="number" step="0.01" className="input" value={f.lat} onChange={(e) => setF({ ...f, lat: +e.target.value })} /></div>
              <div><label className="label">Origin lng</label><input type="number" step="0.01" className="input" value={f.lng} onChange={(e) => setF({ ...f, lng: +e.target.value })} /></div>
              <div><label className="label">Min provider tier</label><select className="input" value={f.minTier} onChange={(e) => setF({ ...f, minTier: e.target.value })}><option>UNVERIFIED</option><option>VERIFIED</option><option>TRUSTED</option></select></div>
              <label className="flex items-end gap-2 pb-1 text-sm"><input type="checkbox" checked={f.cold} onChange={(e) => setF({ ...f, cold: e.target.checked })} />Cold storage</label>
            </div>
            <details className="text-xs"><summary className="cursor-pointer text-slate-500">Ranking weights (auto-normalised)</summary>
              <div className="mt-2 grid grid-cols-2 gap-2">{(Object.keys(w) as (keyof typeof w)[]).map((k) => <div key={k}><label className="label capitalize">{k} ({w[k]})</label><input type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: +e.target.value })} className="w-full" /></div>)}</div>
            </details>
            <button className="btn w-full" onClick={rank} disabled={busy}>{busy ? 'Ranking…' : 'Rank available capacity'}</button>
            {msg && <p className="rounded bg-slate-100 p-2 text-xs">{msg}</p>}
          </div>

          <div className="space-y-3">
            {!res && <p className="text-sm text-slate-500">Enter a request and rank. Cost = storage + handling + inbound haulage; lead = readiness + transit.</p>}
            {res?.ranked.map((r, i) => (
              <div key={r.candidate.slotId} className="card flex gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2"><span className="font-medium">{i + 1}. {r.candidate.warehouseName}</span><Badge color={r.candidate.tier === 'TRUSTED' ? 'green' : 'blue'}>{r.candidate.tier}</Badge><Badge color="green">score {(r.score * 100).toFixed(0)}</Badge></div>
                  <div className="text-xs text-slate-500">{r.candidate.providerName} · {r.candidate.distanceKm.toFixed(0)} km · ready in {r.leadHours.toFixed(0)} h · {r.candidate.palletsAvailable} pallets free · ₹{r.candidate.pricePerPalletDay}/pallet/day</div>
                  <div className="mt-2 text-lg font-semibold">{inr(r.totalCost)} <span className="text-xs font-normal text-slate-500">for {r.days} days · {inr(r.totalCost / f.pallets / r.days)}/pallet/day all-in</span></div>
                </div>
                <div className="w-44"><ScoreBreakdown terms={r.breakdown} /></div>
                <button className="btn self-center" onClick={() => book([{ slotId: r.candidate.slotId, pallets: f.pallets }])}>Hold {f.pallets}</button>
              </div>
            ))}
            {res && !res.ranked.length && (
              <div className="card">
                <b className="text-sm">No single provider can hold {f.pallets} pallets.</b>
                {res.split ? (
                  <>
                    <p className="text-xs text-slate-600">Suggested split covers {res.split.covered}{res.split.shortfall > 0 && `, short by ${res.split.shortfall}`} pallets for {inr(res.split.totalCost)}:</p>
                    <ul className="my-2 text-sm">{res.split.lines.map((l) => <li key={l.candidate.slotId}>{l.pallets} × {l.candidate.warehouseName} — {inr(l.cost)}</li>)}</ul>
                    <button className="btn" onClick={() => book(res.split!.lines.map((l) => ({ slotId: l.candidate.slotId, pallets: l.pallets })))}>Hold split booking</button>
                  </>
                ) : <p className="text-xs text-slate-600">No eligible capacity for these dates.</p>}
              </div>
            )}
            {res && res.rejected.length > 0 && <details className="text-xs text-slate-500"><summary className="cursor-pointer">{res.rejected.length} slots filtered out</summary><ul className="mt-1 list-disc pl-5">{res.rejected.map((x) => <li key={x.slotId}>{x.reason}</li>)}</ul></details>}
          </div>
        </div>
      )}
    </>
  );
}
