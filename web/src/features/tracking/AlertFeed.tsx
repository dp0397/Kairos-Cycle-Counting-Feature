import { useQueryClient } from '@tanstack/react-query';
import { api, useGet } from '../../api/client';
import { Badge } from '../../components/ui';

interface Alert { id: string; severity: 'INFO' | 'WARN' | 'CRITICAL'; kind: string; message: string; ts: string; ackAt: string | null; warehouse: { name: string } }

export default function AlertFeed({ openOnly, warehouseId }: { openOnly?: boolean; warehouseId?: string }) {
  const qc = useQueryClient();
  const q = `/alerts?${openOnly ? 'open=true&' : ''}${warehouseId ? `warehouseId=${warehouseId}` : ''}`;
  const { data } = useGet<Alert[]>(['alerts', q], q, { refetchInterval: 10_000 });
  if (!data?.length) return <p className="text-sm text-slate-500">No alerts.</p>;
  return (
    <ul className="max-h-72 space-y-2 overflow-y-auto">
      {data.slice(0, 25).map((a) => (
        <li key={a.id} className={`rounded border p-2 text-xs ${a.ackAt ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between"><Badge color={a.severity === 'CRITICAL' ? 'red' : a.severity === 'WARN' ? 'amber' : 'slate'}>{a.severity}</Badge><span className="text-slate-400">{new Date(a.ts).toLocaleTimeString()}</span></div>
          <div className="mt-1">{a.message}</div>
          {!a.ackAt && <button className="mt-1 text-emerald-700 underline" onClick={async () => { await api(`/alerts/${a.id}/ack`, { method: 'POST', body: {} }); qc.invalidateQueries({ queryKey: ['alerts'] }); }}>Acknowledge</button>}
        </li>
      ))}
    </ul>
  );
}
