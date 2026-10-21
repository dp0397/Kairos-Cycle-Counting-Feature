import { useState } from 'react';
import { api, getToken } from '../../api/client';

const SAMPLE = `warehouseCode,startDate,endDate,pallets,pricePerPalletDay,handlingPerPallet,readyHours
GJ-P-DEESA1,2027-03-01,2027-06-30,300,9.5,14,12
GJ-P-PLN1,2027-03-01,2027-06-30,450,9.0,15,24`;

/** Providers (or CWC on their behalf) publish capacity by CSV or by pasting JSON-equivalent rows. */
export default function CapacityUploadWizard() {
  const [csv, setCsv] = useState(SAMPLE);
  const [out, setOut] = useState<{ created: number; errors: { index: number; error: string }[] } | null>(null);
  const [err, setErr] = useState('');
  async function submit() {
    setErr('');
    try {
      const r = await fetch('/api/v1/capacity/ingest/csv', { method: 'POST', headers: { 'content-type': 'text/csv', authorization: `Bearer ${getToken()}` }, body: csv });
      const j = await r.json(); if (!r.ok) throw new Error(j.error); setOut(j);
    } catch (e) { setErr((e as Error).message); }
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-2">
        <h2 className="text-sm font-semibold">Publish pallet capacity (CSV)</h2>
        <p className="text-xs text-slate-500">One row per offer. Only private 3PL/2PL warehouse codes are accepted; partners can publish only for their own sites. Equivalent JSON API: <code>POST /capacity/ingest</code>.</p>
        <textarea className="input h-44 font-mono text-xs" value={csv} onChange={(e) => setCsv(e.target.value)} />
        <div className="flex gap-2"><input type="file" accept=".csv" className="text-xs" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} /><button className="btn ml-auto" onClick={submit}>Upload</button></div>
      </div>
      <div className="card">
        <h2 className="mb-2 text-sm font-semibold">Result</h2>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {out && <><p className="text-sm">{out.created} slot(s) created.</p>{out.errors.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-red-600">{out.errors.map((e, i) => <li key={i}>row {e.index + 1}: {e.error}</li>)}</ul>}</>}
        {!out && !err && <p className="text-sm text-slate-500">Nothing uploaded yet.</p>}
      </div>
    </div>
  );
}
