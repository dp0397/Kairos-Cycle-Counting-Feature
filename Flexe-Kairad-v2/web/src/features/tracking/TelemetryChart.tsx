import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

interface Pt { kind: string; value: number; ts: string; sensorId?: string | null }
const COLORS: Record<string, string> = { TILT: '#dc2626', LOAD: '#d97706', CRACK: '#7c3aed', VIBRATION: '#0369a1', HUMIDITY: '#047857' };

export default function TelemetryChart({ history, kinds }: { history: Pt[]; kinds: string[] }) {
  // Normalise each series to % of its own max so different units share an axis.
  const max: Record<string, number> = {};
  history.forEach((h) => (max[h.kind] = Math.max(max[h.kind] ?? 0, h.value)));
  const byTs = new Map<string, Record<string, number | string>>();
  history.forEach((h) => {
    const k = new Date(h.ts).toISOString().slice(0, 19);
    const row = byTs.get(k) ?? { t: new Date(h.ts).toLocaleTimeString() };
    row[h.kind] = +((h.value / (max[h.kind] || 1)) * 100).toFixed(1);
    byTs.set(k, row);
  });
  const data = [...byTs.values()].slice(-120);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} /><YAxis tick={{ fontSize: 10 }} unit="%" /><Tooltip /><Legend />
        {kinds.map((k) => <Line key={k} dataKey={k} stroke={COLORS[k]} dot={false} strokeWidth={1.5} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}
