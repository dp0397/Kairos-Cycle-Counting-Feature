import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, inr, mt, pct, type RouteResult } from '../../api/client';
import { Badge, ScoreBreakdown } from '../../components/ui';

interface Props { origin: [number, number] | null; onResult: (r: RouteResult | null) => void }

export default function RoutingPanel({ origin, onResult }: Props) {
  const [qty, setQty] = useState(15000);
  const [months, setMonths] = useState(4);
  const [w, setW] = useState({ proximity: 30, lead: 25, capacity: 20, tariff: 25 });
  const [res, setRes] = useState<RouteResult | null>(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);

  async function run() {
    if (!origin) return;
    setBusy(true); setErr('');
    try {
      const r = await api<RouteResult>('/routing/recommend', { body: { originLat: origin[0], originLng: origin[1], commodity: 'potato', quantityMT: qty, storageMonths: months, needCold: true, weights: w } });
      setRes(r); onResult(r);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="card space-y-3">
      <h2 className="text-sm font-semibold">Route a potato lot</h2>
      <p className="text-xs text-slate-500">{origin ? `Origin ${origin[0].toFixed(3)}, ${origin[1].toFixed(3)}` : 'Click the map to set the pickup origin.'}</p>
      <div className="grid grid-cols-2 gap-2">
        <div><label className="label">Quantity (MT)</label><input type="number" className="input" value={qty} onChange={(e) => setQty(+e.target.value)} /></div>
        <div><label className="label">Storage (months)</label><input type="number" className="input" value={months} onChange={(e) => setMonths(+e.target.value)} /></div>
      </div>
      <details className="text-xs"><summary className="cursor-pointer text-slate-500">Scoring weights</summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {(Object.keys(w) as (keyof typeof w)[]).map((k) => (
            <div key={k}><label className="label capitalize">{k} ({w[k]})</label><input type="range" min={0} max={100} value={w[k]} onChange={(e) => setW({ ...w, [k]: +e.target.value })} className="w-full" /></div>
          ))}
        </div>
      </details>
      <button className="btn w-full" disabled={!origin || busy} onClick={run}>{busy ? 'Scoring…' : 'Recommend facility'}</button>
      {err && <p className="text-sm text-red-600">{err}</p>}

      {res && (
        <div className="space-y-2">
          <div className={`rounded border p-2 text-sm ${res.overflow.recommended ? 'border-amber-300 bg-amber-50' : 'border-emerald-300 bg-emerald-50'}`}>
            <b>{res.overflow.recommended ? 'Overflow to flexible 3PL capacity' : 'Fits in the CWC/SWC network'}</b>
            <div className="text-xs text-slate-600">{res.overflow.reason}{res.overflow.overflowMT > 0 && ` — ${mt(res.overflow.overflowMT)} unplaced`}</div>
            {res.overflow.recommended && <Link to="/capacity" className="mt-1 inline-block text-xs text-emerald-800 underline">Open 3PL marketplace →</Link>}
          </div>
          {res.ranked.slice(0, 4).map((r, i) => (
            <div key={r.facility.id} className="rounded border border-slate-200 p-2">
              <div className="flex items-center justify-between"><span className="text-sm font-medium">{i + 1}. {r.facility.name}</span><Badge color="green">{(r.score * 100).toFixed(0)}</Badge></div>
              <div className="mb-1 text-xs text-slate-500">{r.distanceKm.toFixed(0)} km · ready in {r.leadHours.toFixed(0)} h · {mt(r.freeMT)} free · {pct(r.utilisationAfter)} after · {inr(r.storageCost)}</div>
              <ScoreBreakdown terms={r.breakdown} />
            </div>
          ))}
          {res.allocation.length > 1 && <p className="text-xs text-slate-600">Split plan: {res.allocation.map((a) => `${a.name} ${mt(a.mt)}`).join(' + ')}</p>}
        </div>
      )}
    </div>
  );
}
