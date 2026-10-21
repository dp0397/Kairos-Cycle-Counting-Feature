/** Live asset register on the floor plan: replaces manual cycle counts. SVG, 100×60 m. */
export interface TwinZone { code: string; x: number; y: number; w: number; h: number; usedMT: number; capacityMT: number }
export interface TwinAsset { id: string; label: string; zone: string | null; x: number | null; y: number | null; batteryV?: number | null; lastSeen?: string | null }

export default function LiveAssetMap({ zones, gateways, assets }: { zones: TwinZone[]; gateways: { id: string; name: string; x: number; y: number }[]; assets: TwinAsset[] }) {
  // Jitter assets within their zone so co-located pallets don't overlap (position = gateway zone, not true XY).
  const jit = (s: string, n: number) => ((s.charCodeAt(s.length - 1) * 37 + s.charCodeAt(s.length - 2) * 11) % n) - n / 2;
  return (
    <svg viewBox="-2 -2 104 64" className="w-full rounded border border-slate-200 bg-white">
      {zones.map((z) => (
        <g key={z.code}>
          <rect x={z.x} y={z.y} width={z.w} height={z.h} fill="#f1f5f9" stroke="#94a3b8" strokeWidth={0.3} />
          <text x={z.x + 1.5} y={z.y + 4} fontSize={3} fill="#475569">Zone {z.code} · {Math.round((z.usedMT / z.capacityMT) * 100)}%</text>
        </g>
      ))}
      {gateways.map((g) => <g key={g.id}><circle cx={g.x} cy={g.y} r={1.2} fill="#0369a1" /><text x={g.x + 1.8} y={g.y + 1} fontSize={2} fill="#0369a1">{g.name}</text></g>)}
      {assets.map((a) => {
        const low = (a.batteryV ?? 3) < 2.9;
        return <rect key={a.id} x={(a.x ?? 0) + jit(a.id, 14) - 1} y={(a.y ?? 0) + jit(a.label, 10) + 3} width={2} height={2} rx={0.3} fill={low ? '#dc2626' : '#047857'}><title>{a.label} · zone {a.zone ?? '?'} · {a.batteryV?.toFixed(2) ?? '–'} V</title></rect>;
      })}
    </svg>
  );
}
