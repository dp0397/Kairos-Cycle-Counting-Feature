import * as maplibregl from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import type { Warehouse } from '../../api/client';

const KIND_COLOR: Record<string, string> = { CWC: '#047857', SWC: '#0369a1', PRIVATE_3PL: '#b45309', PRIVATE_2PL: '#a16207' };

interface Props {
  production: GeoJSON.FeatureCollection | undefined;
  warehouses: Warehouse[];
  origin: [number, number] | null;
  highlight: string[];
  onPickOrigin: (lat: number, lng: number) => void;
}

export default function CommodityHeatmapMap({ production, warehouses, origin, highlight, onPickOrigin }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const pick = useRef(onPickOrigin);
  pick.current = onPickOrigin;

  useEffect(() => {
    const m = new maplibregl.Map({
      container: el.current!,
      center: [71.6, 22.6], zoom: 6.1, maxBounds: [[66.5, 19.5], [76.5, 25.5]], // Gujarat pilot extent
      style: {
        version: 8,
        sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    m.on('click', (e) => pick.current(e.lngLat.lat, e.lngLat.lng));
    map.current = m;
    return () => m.remove();
  }, []);

  // Heat layer — weight = forecast MT
  useEffect(() => {
    const m = map.current; if (!m || !production) return;
    const apply = () => {
      const max = Math.max(1, ...production.features.map((f) => f.properties!.forecastMT));
      if (m.getSource('prod')) { (m.getSource('prod') as maplibregl.GeoJSONSource).setData(production); return; }
      m.addSource('prod', { type: 'geojson', data: production });
      m.addLayer({
        id: 'heat', type: 'heatmap', source: 'prod',
        paint: {
          'heatmap-weight': ['interpolate', ['linear'], ['get', 'forecastMT'], 0, 0, max, 1],
          'heatmap-radius': 60, 'heatmap-intensity': 1.1, 'heatmap-opacity': 0.75,
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(255,255,178,0)', 0.2, '#fed976', 0.5, '#fd8d3c', 0.8, '#e31a1c', 1, '#800026'],
        },
      });
      m.addLayer({ id: 'prod-label', type: 'symbol', source: 'prod', layout: { 'text-field': ['get', 'district'], 'text-size': 10, 'text-offset': [0, 1.2] }, paint: { 'text-color': '#7c2d12', 'text-halo-color': '#fff', 'text-halo-width': 1 } });
    };
    m.loaded() ? apply() : m.once('load', apply);
  }, [production]);

  // Warehouse + origin markers
  useEffect(() => {
    const m = map.current; if (!m) return;
    markers.current.forEach((x) => x.remove()); markers.current = [];
    for (const w of warehouses) {
      const d = document.createElement('div');
      const hl = highlight.includes(w.id);
      const size = hl ? 18 : 12;
      d.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;background:${KIND_COLOR[w.kind]};border:2px solid ${hl ? '#111' : '#fff'};box-shadow:0 0 0 ${w.utilisation > 0.85 ? 3 : 0}px rgba(220,38,38,.55);cursor:pointer`;
      const popup = new maplibregl.Popup({ offset: 10, closeButton: false }).setHTML(
        `<b>${w.name}</b><br/>${w.kind.replace('_', ' ')} · ${(w.utilisation * 100).toFixed(0)}% full<br/>₹${w.tariffPerMTMonth}/MT/mo`);
      markers.current.push(new maplibregl.Marker({ element: d }).setLngLat([w.lng, w.lat]).setPopup(popup).addTo(m));
    }
    if (origin) {
      const o = document.createElement('div');
      o.style.cssText = 'width:16px;height:16px;background:#111;transform:rotate(45deg);border:2px solid #fff';
      markers.current.push(new maplibregl.Marker({ element: o }).setLngLat([origin[1], origin[0]]).addTo(m));
    }
  }, [warehouses, origin, highlight]);

  return <div ref={el} className="h-[540px] w-full overflow-hidden rounded-lg border border-slate-200" />;
}
