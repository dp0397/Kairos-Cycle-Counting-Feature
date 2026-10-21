import { useQueryClient } from '@tanstack/react-query';
import { api, inr, useGet } from '../../api/client';
import { Badge } from '../../components/ui';

interface Booking { id: string; ref: string; status: string; totalCost: number; createdAt: string; holdUntil: string | null; lines: { id: string; pallets: number; slot: { warehouse: { name: string } } }[] }

export default function BookingsTable() {
  const qc = useQueryClient();
  const { data } = useGet<Booking[]>(['bookings'], '/bookings');
  const act = async (id: string, a: 'confirm' | 'cancel') => { await api(`/bookings/${id}/${a}`, { method: 'PATCH' }).catch((e) => alert(e.message)); qc.invalidateQueries({ queryKey: ['bookings'] }); };
  return (
    <div className="card overflow-x-auto">
      <table className="w-full"><thead><tr>{['Ref', 'Status', 'Facilities', 'Pallets', 'Total', 'Hold until', ''].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {data?.map((b) => (
            <tr key={b.id}>
              <td className="td font-mono text-xs">{b.ref}</td>
              <td className="td"><Badge color={b.status === 'CONFIRMED' ? 'green' : b.status === 'HELD' ? 'amber' : 'slate'}>{b.status}</Badge></td>
              <td className="td">{b.lines.map((l) => l.slot.warehouse.name).join(', ')}</td>
              <td className="td">{b.lines.reduce((s, l) => s + l.pallets, 0)}</td>
              <td className="td">{inr(b.totalCost)}</td>
              <td className="td text-xs">{b.holdUntil ? new Date(b.holdUntil).toLocaleString() : '—'}</td>
              <td className="td space-x-1">
                {b.status === 'HELD' && <button className="btn" onClick={() => act(b.id, 'confirm')}>Confirm</button>}
                {(b.status === 'HELD' || b.status === 'CONFIRMED') && <button className="btn-ghost" onClick={() => act(b.id, 'cancel')}>Cancel</button>}
              </td>
            </tr>
          ))}
          {data?.length === 0 && <tr><td className="td text-slate-500" colSpan={7}>No bookings yet.</td></tr>}
        </tbody></table>
    </div>
  );
}
