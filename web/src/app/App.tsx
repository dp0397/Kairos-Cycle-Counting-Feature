import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, getToken, setToken } from '../api/client';
import ExecutiveOverview from '../features/dashboard/ExecutiveOverview';
import HeatmapPage from '../features/heatmap/HeatmapPage';
import CapacityPage from '../features/capacity/CapacityPage';
import TrackingPage from '../features/tracking/TrackingPage';
import WmsPage from '../features/wms/WmsPage';
import { InventoryProvider } from '../features/inventory/store';
import CycleCountsPage from '../features/inventory/CycleCountsPage';
import MasterDataPage from '../features/inventory/MasterDataPage';
import InventoryControlPage from '../features/inventory/InventoryControlPage';

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('admin@cwc.local');
  const [password, setPassword] = useState('demo1234');
  const [err, setErr] = useState('');
  return (
    <div className="mx-auto mt-32 w-80 card">
      <h1 className="mb-1 text-lg font-semibold">Kairad Warehousing app</h1>
      <p className="mb-4 text-xs text-slate-500">Sign in</p>
      <label className="label">Email</label><input className="input mb-2" value={email} onChange={(e) => setEmail(e.target.value)} />
      <label className="label">Password</label><input type="password" className="input mb-3" value={password} onChange={(e) => setPassword(e.target.value)} />
      {err && <p className="mb-2 text-sm text-red-600">{err}</p>}
      <button className="btn w-full" onClick={async () => {
        try { const r = await api<{ token: string }>('/auth/login', { body: { email, password } }); setToken(r.token); onDone(); }
        catch (e) { setErr((e as Error).message); }
      }}>Sign in</button>
    </div>
  );
}

const nav = [
  ['/', 'Overview'], ['/heatmap', 'Heatmap & Routing'], ['/capacity', '3PL Capacity'], ['/tracking', 'Tracking & Twin'], ['/wms', 'WMS & Gov Platforms'],
] as const;
const invNav = [['/cycle-counts', 'Cycle counts'], ['/master-data', 'Master data'], ['/inventory-control', 'Inventory control']] as const;
const linkCls = ({ isActive }: { isActive: boolean }) => `block rounded px-2 py-1.5 text-sm ${isActive ? 'bg-emerald-700 text-white' : 'hover:bg-slate-800'}`;

export default function App() {
  const [authed, setAuthed] = useState(!!getToken());
  if (!authed) return <Login onDone={() => setAuthed(true)} />;
  return (
    <InventoryProvider>
    <div className="flex min-h-screen">
      <aside className="w-56 shrink-0 bg-slate-900 p-4 text-slate-200">
        <div className="mb-6 text-sm font-semibold text-white">Kairad Warehousing app</div>
        <nav className="space-y-1">
          {nav.map(([to, label]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `block rounded px-2 py-1.5 text-sm ${isActive ? 'bg-emerald-700 text-white' : 'hover:bg-slate-800'}`}>{label}</NavLink>
          ))}
          <div className="px-2 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Inventory</div>
          {invNav.map(([to, label]) => <NavLink key={to} to={to} className={linkCls}>{label}</NavLink>)}
        </nav>
        <button className="mt-8 text-xs text-slate-400 hover:text-white" onClick={() => { setToken(null); setAuthed(false); }}>Sign out</button>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Routes>
          <Route path="/" element={<ExecutiveOverview />} />
          <Route path="/heatmap" element={<HeatmapPage />} />
          <Route path="/capacity" element={<CapacityPage />} />
          <Route path="/tracking" element={<TrackingPage />} />
          <Route path="/wms" element={<WmsPage />} />
          <Route path="/cycle-counts" element={<CycleCountsPage />} />
          <Route path="/master-data" element={<MasterDataPage />} />
          <Route path="/inventory-control" element={<InventoryControlPage />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
    </InventoryProvider>
  );
}
