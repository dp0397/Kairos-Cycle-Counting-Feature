import { Link } from 'react-router-dom';
import { mt, pct, useGet } from '../../api/client';
import { PageHeader, Stat } from '../../components/ui';
import AlertFeed from '../tracking/AlertFeed';

interface Summary {
  warehouses: number; internalCapacityMT: number; internalUsedMT: number; internalUtilisation: number;
  forecastProductionMT: number; surgeDemandMT: number; flexPalletsOpen: number; openBookings: number; criticalAlerts: number;
}

export default function ExecutiveOverview() {
  const { data: s } = useGet<Summary>(['summary'], '/network/summary?commodity=potato', { refetchInterval: 30_000 });
  if (!s) return <p className="text-sm text-slate-500">Loading…</p>;
  return (
    <>
      <PageHeader title="Gujarat network overview" sub="Potato season 2026-27 · internal capacity vs. forecast harvest" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Internal utilisation" value={pct(s.internalUtilisation)} sub={`${mt(s.internalUsedMT)} of ${mt(s.internalCapacityMT)}`} tone={s.internalUtilisation > 0.85 ? 'bad' : s.internalUtilisation > 0.7 ? 'warn' : undefined} />
        <Stat label="Forecast harvest" value={mt(s.forecastProductionMT)} sub="Potato, all Gujarat districts (illustrative)" />
        <Stat label="Projected overflow need" value={mt(s.surgeDemandMT)} sub="~35% of harvest to storage minus free internal space" tone={s.surgeDemandMT > 0 ? 'warn' : undefined} />
        <Stat label="Flex pallets open" value={s.flexPalletsOpen.toLocaleString('en-IN')} sub={`${s.openBookings} active bookings`} />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <h2 className="mb-2 text-sm font-semibold">What to do</h2>
          <ul className="space-y-2 text-sm">
            <li>1. <Link className="text-emerald-700 underline" to="/heatmap">Route a lot</Link> — internal-first recommendation by proximity, lead time, headroom and tariff.</li>
            <li>2. If internal space is exhausted, <Link className="text-emerald-700 underline" to="/capacity">rank and book 3PL pallets</Link> — cost and lead time scored together.</li>
            <li>3. <Link className="text-emerald-700 underline" to="/tracking">Track</Link> pallets by BLE tag and watch structural health in the digital twin.</li>
            <li>4. Run inbound, putaway and picking in <Link className="text-emerald-700 underline" to="/wms">WMS</Link>.</li>
          </ul>
        </div>
        <div className="card"><h2 className="mb-2 text-sm font-semibold">Open alerts {s.criticalAlerts > 0 && <span className="text-red-600">({s.criticalAlerts} critical)</span>}</h2><AlertFeed openOnly /></div>
      </div>
    </>
  );
}
