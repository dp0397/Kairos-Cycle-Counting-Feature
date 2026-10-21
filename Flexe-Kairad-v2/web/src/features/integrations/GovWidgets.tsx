import { useQueryClient } from '@tanstack/react-query';
import { api, mt, useGet } from '../../api/client';
import { Badge, Bar } from '../../components/ui';

interface Env<T> { mode: 'MOCK' | 'LIVE'; data: T }

function Shell({ title, mode, onSync, children }: { title: string; mode?: string; onSync: () => void; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-semibold">{title}</h2>
        <div className="flex items-center gap-2">{mode && <Badge color={mode === 'LIVE' ? 'green' : 'amber'}>{mode}</Badge>}<button className="btn-ghost" onClick={onSync}>Sync</button></div></div>
      {children}
    </div>
  );
}

export function SmartPdsWidget() {
  const qc = useQueryClient();
  const { data } = useGet<Env<{ month: string; foodgrainAllocatedMT: number; foodgrainLiftedMT: number; fpsReporting: number; fpsTotal: number; stockAtCwcDepotsMT: number }>>(['smartpds'], '/integrations/smart-pds/summary');
  const d = data?.data;
  return (
    <Shell title="SMART PDS" mode={data?.mode} onSync={async () => { await api('/integrations/smart-pds/sync', { body: {} }).catch((e) => alert(e.message)); qc.invalidateQueries({ queryKey: ['smartpds'] }); }}>
      {d ? <div className="space-y-2 text-sm">
        <div><div className="flex justify-between text-xs text-slate-500"><span>Lifted vs allocated ({d.month})</span><span>{mt(d.foodgrainLiftedMT)} / {mt(d.foodgrainAllocatedMT)}</span></div><Bar value={d.foodgrainLiftedMT / d.foodgrainAllocatedMT} tone="bg-emerald-600" /></div>
        <div><div className="flex justify-between text-xs text-slate-500"><span>Fair-price shops reporting</span><span>{d.fpsReporting.toLocaleString('en-IN')} / {d.fpsTotal.toLocaleString('en-IN')}</span></div><Bar value={d.fpsReporting / d.fpsTotal} tone="bg-sky-500" /></div>
        <div className="text-xs text-slate-500">Stock at CWC/SWC depots: <b className="text-slate-800">{mt(d.stockAtCwcDepotsMT)}</b></div>
      </div> : <p className="text-sm text-slate-500">Loading…</p>}
    </Shell>
  );
}

export function DepotDarpanWidget() {
  const qc = useQueryClient();
  const { data } = useGet<Env<{ depotsRegistered: number; depotsMapped: number; capacityMT: number; storedMT: number; occupancyPct: number; mismatches: { code: string; name: string; reason: string }[] }>>(['darpan'], '/integrations/depot-darpan/summary');
  const d = data?.data;
  return (
    <Shell title="Depot Darpan" mode={data?.mode} onSync={async () => { await api('/integrations/depot-darpan/sync', { body: {} }).catch((e) => alert(e.message)); qc.invalidateQueries({ queryKey: ['darpan'] }); }}>
      {d ? <div className="space-y-2 text-sm">
        <div className="flex justify-between text-xs text-slate-500"><span>Depots mapped</span><span>{d.depotsMapped} / {d.depotsRegistered}</span></div><Bar value={d.depotsMapped / d.depotsRegistered} tone="bg-emerald-600" />
        <div className="flex justify-between text-xs text-slate-500"><span>Occupancy</span><span>{d.occupancyPct}% · {mt(d.storedMT)} of {mt(d.capacityMT)}</span></div><Bar value={d.occupancyPct / 100} />
        {d.mismatches.length > 0 && <ul className="text-xs text-amber-700">{d.mismatches.map((m) => <li key={m.code}>⚠ {m.name}: {m.reason}</li>)}</ul>}
      </div> : <p className="text-sm text-slate-500">Loading…</p>}
    </Shell>
  );
}
