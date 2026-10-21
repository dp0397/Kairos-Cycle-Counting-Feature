# Kairad Warehousing app

Internal-first routing of seasonal produce to CWC/SWC warehouses, overflow to a transaction-based 3PL pallet marketplace, BLE/digital-twin tracking, and a unified WMS view with SMART PDS / Depot Darpan widgets.

> Seed data is **illustrative** (real towns, invented capacities/tariffs/forecasts/providers). External
> integrations run in **MOCK** mode until real endpoints and credentials exist.

## Run

```bash
docker compose up -d db                # Postgres on host port 5491 (or use any local Postgres and edit server/.env)
cd server && cp .env.example .env && npm i
npx prisma db push && npm run db:seed
npm run dev                            # API on :4391
npm run simulate -- --spike            # (optional) BLE + structural telemetry simulator
cd ../web && npm i && npm run dev      # UI on :5391
```

Dev logins (password `demo1234`): `admin@cwc.local`, `manager@cwc.local`, `partner@banas.local`, `auditor@cwc.local`.

## Test

`cd server && npm test` (routing + 3PL ranking, hand-computed fixtures) · `npm run typecheck` in both packages.

## Layout

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Phase 1 scope = Gujarat (`ACTIVE_STATES=GJ`).