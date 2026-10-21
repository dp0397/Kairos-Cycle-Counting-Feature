import type { ReactNode } from 'react';

export const Stat = ({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' | 'bad' }) => (
  <div className="card">
    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
    <div className={`mt-1 text-2xl font-semibold ${tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : ''}`}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
  </div>
);

export const Bar = ({ value, tone }: { value: number; tone?: string }) => (
  <div className="h-1.5 w-full rounded bg-slate-200">
    <div className={`h-1.5 rounded ${tone ?? (value > 0.9 ? 'bg-red-500' : value > 0.75 ? 'bg-amber-500' : 'bg-emerald-600')}`} style={{ width: `${Math.min(100, value * 100)}%` }} />
  </div>
);

export const Badge = ({ children, color = 'slate' }: { children: ReactNode; color?: 'slate' | 'green' | 'amber' | 'red' | 'blue' }) => {
  const c = { slate: 'bg-slate-100 text-slate-700', green: 'bg-emerald-100 text-emerald-800', amber: 'bg-amber-100 text-amber-800', red: 'bg-red-100 text-red-700', blue: 'bg-sky-100 text-sky-800' }[color];
  return <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${c}`}>{children}</span>;
};

export const PageHeader = ({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) => (
  <div className="mb-4 flex items-end justify-between">
    <div><h1 className="text-xl font-semibold">{title}</h1>{sub && <p className="text-sm text-slate-500">{sub}</p>}</div>
    {right}
  </div>
);

/** Per-term score breakdown, used by both routing and 3PL ranking so managers can see *why*. */
export const ScoreBreakdown = ({ terms }: { terms: Record<string, number> }) => (
  <div className="grid grid-cols-2 gap-x-3 gap-y-1">
    {Object.entries(terms).map(([k, v]) => (
      <div key={k}><div className="flex justify-between text-[10px] uppercase text-slate-500"><span>{k}</span><span>{(v * 100).toFixed(0)}</span></div><Bar value={v} tone="bg-sky-500" /></div>
    ))}
  </div>
);
