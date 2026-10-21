import { useState } from 'react';
import { useGet, type RouteResult, type Warehouse } from '../../api/client';
import { PageHeader } from '../../components/ui';
import CommodityHeatmapMap from './CommodityHeatmapMap';
import RoutingPanel from './RoutingPanel';

export default function HeatmapPage() {
  const [commodity, setCommodity] = useState('potato');
  const [origin, setOrigin] = useState<[number, number] | null>([24.26, 72.19]);
  const [result, setResult] = useState<RouteResult | null>(null);
  const prod = useGet<GeoJSON.FeatureCollection>(['prod', commodity], `/production/heatmap?commodity=${commodity}`);
  const wh = useGet<Warehouse[]>(['warehouses'], '/warehouses');

  return (
    <>
      <PageHeader title="Commodity heatmap & routing" sub="Forecast production density vs. warehouse locations · red halo = >85% full"
        right={<select className="input w-40" value={commodity} onChange={(e) => setCommodity(e.target.value)}><option value="potato">Potato</option><option value="groundnut">Groundnut</option><option value="cotton">Cotton</option></select>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div>
          <CommodityHeatmapMap production={prod.data} warehouses={wh.data ?? []} origin={origin} highlight={result?.ranked.slice(0, 3).map((r) => r.facility.id) ?? []} onPickOrigin={(a, b) => { setOrigin([a, b]); setResult(null); }} />
          <div className="mt-2 flex gap-4 text-xs text-slate-600">
            {[['CWC', '#047857'], ['SWC', '#0369a1'], ['Private 3PL', '#b45309'], ['Private 2PL', '#a16207']].map(([l, c]) => <span key={l}><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />{l}</span>)}
            <span>◆ pickup origin</span>
          </div>
        </div>
        <RoutingPanel origin={origin} onResult={setResult} />
      </div>
    </>
  );
}
