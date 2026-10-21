import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, mt, useGet, type Warehouse } from '../../api/client';
import { Badge, PageHeader } from '../../components/ui';
import { DepotDarpanWidget, SmartPdsWidget } from '../integrations/GovWidgets';

interface Trailer { id: string; carrier: string; plate: string; commodity: string; expectedMT: number; status: string; scheduledAt: string; doorNo: number | null; putaways: { id: string; status: string }[] }
interface Putaway { id: string; mt: number; reason: string; status: string; zone: { code: string }; trailer: { plate: string } }
interface Rule { id: string; name: string; strategy: string; priority: number; commodity: string | null }
interface PickTask { id: string; orderRef: string; mt: number; ruleName: string; lines: { zone: string; mt: number }[]; createdAt: string }

const COLS = ['SCHEDULED', 'ARRIVED', 'DOCKED', 'UNLOADING', 'COMPLETED'];
const NEXT: Record<string, string> = { SCHEDULED: 'ARRIVED', ARRIVED: 'DOCKED', DOCKED: 'UNLOADING', UNLOADING: 'COMPLETED' };

export default function WmsPage() {
  const qc = useQueryClient();
  const whs = useGet<Warehouse[]>(['warehouses'], '/warehouses');
  const demo = whs.data?.find((w) => w.code === 'GJ-CWC-DEESA');
  const wid = demo?.id;
  const trailers = useGet<Trailer[]>(['trailers', wid], `/inbound/trailers?warehouseId=${wid}`, { enabled: !!wid, refetchInterval: 10_000 });
  const putaways = useGet<Putaway[]>(['putaways', wid], `/putaway/tasks?warehouseId=${wid}`, { enabled: !!wid });
  const rules = useGet<Rule[]>(['rules', wid], `/picking/rules?warehouseId=${wid}`, { enabled: !!wid });
  const picks = useGet<PickTask[]>(['picks', wid], `/picking/tasks?warehouseId=${wid}`, { enabled: !!wid });
  const [order, setOrder] = useState({ orderRef: 'PDS-GJ-0001', mt: 40 });
  const [note, setNote] = useState('');
  const refresh = () => ['trailers', 'putaways', 'picks'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const guard = async (fn: () => Promise<unknown>) => { setNote(''); try { await fn(); refresh(); } catch (e) { setNote((e as Error).message); } };

  const advance = (t: Trailer) => guard(() => api(`/inbound/trailers/${t.id}/status`, { method: 'PATCH', body: { status: NEXT[t.status], ...(NEXT[t.status] === 'DOCKED' ? { doorNo: (t.doorNo ?? 1 + Math.floor(Math.random() * 6)) } : {}) } }));
  const direct = (t: Trailer) => guard(() => api('/putaway/suggest', { body: { trailerId: t.id, needCold: true, create: true } }));

  return (
    <>
      <PageHeader title="Unified WMS" sub={`${demo?.name ?? '…'} · inbound trailers, system-directed putaway, rule-driven picking`} />
      {note && <p className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">{note}</p>}

      <div className="mb-4 grid gap-3 md:grid-cols-2"><SmartPdsWidget /><DepotDarpanWidget /></div>

      <div className="card mb-4">
        <h2 className="mb-3 text-sm font-semibold">Inbound trailer board</h2>
        <div className="grid grid-cols-5 gap-2">
          {COLS.map((c) => (
            <div key={c} className="rounded bg-slate-50 p-2"><div className="mb-2 text-xs font-semibold text-slate-500">{c} ({trailers.data?.filter((t) => t.status === c).length ?? 0})</div>
              <div className="space-y-2">{trailers.data?.filter((t) => t.status === c).map((t) => (
                <div key={t.id} className="rounded border border-slate-200 bg-white p-2 text-xs">
                  <div className="font-medium">{t.plate}</div><div className="text-slate-500">{t.carrier} · {mt(t.expectedMT)}</div>
                  <div className="text-slate-400">{new Date(t.scheduledAt).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}{t.doorNo && ` · Door ${t.doorNo}`}</div>
                  <div className="mt-1 flex gap-1">
                    {NEXT[t.status] && <button className="btn-ghost !px-1.5 !py-0.5 text-xs" onClick={() => advance(t)}>→ {NEXT[t.status]}</button>}
                    {(t.status === 'ARRIVED' || t.status === 'DOCKED' || t.status === 'UNLOADING') && t.putaways.length === 0 && <button className="btn !px-1.5 !py-0.5 text-xs" onClick={() => direct(t)}>Direct putaway</button>}
                  </div>
                </div>))}</div></div>))}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card"><h2 className="mb-2 text-sm font-semibold">System-directed putaway tasks</h2>
          <ul className="space-y-2 text-sm">{putaways.data?.map((p) => (
            <li key={p.id} className="rounded border border-slate-200 p-2"><div className="flex justify-between"><span><b>{p.trailer.plate}</b> → Zone {p.zone.code} · {mt(p.mt)}</span>
              {p.status === 'DONE' ? <Badge color="green">DONE</Badge> : <button className="btn !py-0.5" onClick={() => guard(() => api(`/putaway/tasks/${p.id}/complete`, { body: {} }))}>Complete</button>}</div>
              <div className="text-xs text-slate-500">{p.reason}</div></li>))}
            {putaways.data?.length === 0 && <li className="text-slate-500">Move a trailer to ARRIVED, then “Direct putaway”.</li>}</ul></div>

        <div className="card"><h2 className="mb-2 text-sm font-semibold">Rule-driven picking</h2>
          <ul className="mb-3 text-xs text-slate-600">{rules.data?.map((r) => <li key={r.id}>#{r.priority} · <b>{r.name}</b> — {r.strategy}{r.commodity && ` (${r.commodity})`}</li>)}</ul>
          <div className="mb-3 flex items-end gap-2">
            <div className="flex-1"><label className="label">Order ref</label><input className="input" value={order.orderRef} onChange={(e) => setOrder({ ...order, orderRef: e.target.value })} /></div>
            <div className="w-24"><label className="label">MT potato</label><input type="number" className="input" value={order.mt} onChange={(e) => setOrder({ ...order, mt: +e.target.value })} /></div>
            <button className="btn" onClick={() => guard(() => api('/picking/tasks/generate', { body: { warehouseId: wid, commodity: 'potato', ...order } }))}>Generate pick</button>
          </div>
          <ul className="space-y-1 text-xs">{picks.data?.map((p) => <li key={p.id} className="rounded border border-slate-200 p-2"><b>{p.orderRef}</b> · {mt(p.mt)} via <i>{p.ruleName}</i><br />{p.lines.map((l, i) => <span key={i} className="mr-2">Zone {l.zone}: {mt(l.mt)}</span>)}</li>)}</ul></div>
      </div>
    </>
  );
}
