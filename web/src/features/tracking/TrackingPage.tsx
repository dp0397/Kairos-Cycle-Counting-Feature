import { useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGet, type Warehouse } from '../../api/client';
import { Badge, PageHeader } from '../../components/ui';
import AlertFeed from './AlertFeed';
import DigitalTwinViewer, { type TwinSensor } from './DigitalTwinViewer';
import LiveAssetMap, { type TwinAsset, type TwinZone } from './LiveAssetMap';
import TelemetryChart from './TelemetryChart';
import { useLiveStream } from './useLiveStream';

interface Twin {
  asOf: string; warehouse: { id: string; name: string }; zones: TwinZone[]; gateways: { id: string; name: string; x: number; y: number }[];
  sensors: TwinSensor[]; assets: (TwinAsset & { mt: number | null; pvVoltage: number | null })[]; history: { kind: string; value: number; ts: string; sensorId: string | null }[];
}

export default function TrackingPage() {
  const qc = useQueryClient();
  const whs = useGet<Warehouse[]>(['warehouses'], '/warehouses');
  const demo = whs.data?.find((w) => w.code === 'GJ-CWC-DEESA');
  const twin = useGet<Twin>(['twin', demo?.id], `/twin/${demo?.id}/state`, { enabled: !!demo, refetchInterval: 15_000 });

  // Live events invalidate the twin (throttled to once / 2 s) and alert lists.
  const last = useRef(0);
  useLiveStream(demo?.id, useCallback((type) => {
    if (type === 'alert') qc.invalidateQueries({ queryKey: ['alerts'] });
    if (Date.now() - last.current > 2000) { last.current = Date.now(); qc.invalidateQueries({ queryKey: ['twin'] }); }
  }, [qc]));

  const t = twin.data;
  if (!t) return <p className="text-sm text-slate-500">{demo ? 'Loading twin…' : 'Loading…'} (run <code>npm run simulate</code> in server/ for live data)</p>;
  const stale = (s?: string | null) => !s || Date.now() - new Date(s).getTime() > 60_000;
  const live = t.assets.some((a) => !stale(a.lastSeen));

  return (
    <>
      <PageHeader title={`Tracking & digital twin — ${t.warehouse.name}`} sub="BLE tags (PV-cell powered) replace manual cycle counts · structural feeds from site sensors"
        right={<Badge color={live ? 'green' : 'amber'}>{live ? 'LIVE' : 'No recent data'}</Badge>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="card"><h2 className="mb-2 text-sm font-semibold">3D twin</h2><DigitalTwinViewer zones={t.zones} assets={t.assets} sensors={t.sensors} /></div>
          <div className="card"><h2 className="mb-2 text-sm font-semibold">Live asset register (floor plan)</h2><LiveAssetMap zones={t.zones} gateways={t.gateways} assets={t.assets} /></div>
          <div className="card"><h2 className="mb-2 text-sm font-semibold">Structural & environment telemetry (last hour, % of series max)</h2><TelemetryChart history={t.history} kinds={['TILT', 'LOAD', 'CRACK', 'VIBRATION', 'HUMIDITY']} /></div>
        </div>
        <div className="space-y-4">
          <div className="card"><h2 className="mb-2 text-sm font-semibold">Structural sensors</h2>
            <ul className="space-y-1 text-sm">{t.sensors.map((s) => <li key={s.id} className="flex justify-between"><span className="text-xs">{s.kind} · {s.location}</span><Badge color={s.status === 'CRITICAL' ? 'red' : s.status === 'WARN' ? 'amber' : s.status === 'OK' ? 'green' : 'slate'}>{s.lastValue != null ? `${s.lastValue}${s.unit.startsWith('%') ? '' : ' '}${s.unit}` : '—'}</Badge></li>)}</ul></div>
          <div className="card"><h2 className="mb-2 text-sm font-semibold">Alerts</h2><AlertFeed warehouseId={t.warehouse.id} /></div>
          <div className="card overflow-x-auto"><h2 className="mb-2 text-sm font-semibold">BLE tags</h2>
            <table className="w-full"><thead><tr>{['Pallet', 'Zone', 'Batt', 'PV', 'Seen'].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
              <tbody>{t.assets.map((a) => <tr key={a.id}><td className="td text-xs">{a.label}</td><td className="td">{a.zone ?? '?'}</td><td className={`td ${(a.batteryV ?? 3) < 2.9 ? 'text-red-600' : ''}`}>{a.batteryV?.toFixed(2) ?? '–'}</td><td className="td">{a.pvVoltage?.toFixed(2) ?? '–'}</td><td className="td text-xs">{stale(a.lastSeen) ? 'stale' : 'now'}</td></tr>)}</tbody></table></div>
        </div>
      </div>
    </>
  );
}
