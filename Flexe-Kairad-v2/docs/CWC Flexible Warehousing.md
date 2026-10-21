---
title: CWC Flexible Warehousing (Gujarat pilot)
aliases: [CWC on-demand warehousing, Kairad CWC]
tags: [project/cwc, warehousing, 3pl, logistics, kairad]
status: phase-1-built
created: 2026-10-14
---

# CWC Flexible Warehousing — Gujarat pilot

**One line:** internal-first routing of seasonal produce (potato) to CWC/SWC warehouses, overflow to a transaction-based 3PL pallet marketplace, live BLE/digital-twin tracking, and a unified WMS view with SMART PDS / Depot Darpan widgets. Capex → opex.

Code: `CWC/` (server = Fastify + Prisma + Postgres, web = React/Vite). Proposal: [[Kairad_CWC_Proposal_Revised]].

## Scope decisions
- [x] Phase 1 is **Gujarat only** (`ACTIVE_STATES=GJ`); schema is national.
- [x] **COLT-style truck check-in = provision only** (nullable columns, `TruckCheckInProvider` interface, `trailer.*` events). Not built.
- [x] SMART PDS / Depot Darpan run as **mock adapters** until real APIs/credentials exist.
- [ ] Replace illustrative seed data with CWC warehouse register + state horticulture stats.

## Modules
| Module | What it does |
|---|---|
| Heatmap & routing | Production density map vs. warehouses; recommends site by proximity, lead time, headroom, tariff; flags overflow |
| 3PL aggregator | CSV/JSON capacity ingest, ranked search, atomic holds → confirm/cancel |
| Tracking & twin | BLE tags (PV-cell powered) → live zone register; structural sensors; 3D twin; alerts |
| WMS & gov | Trailer board, directed putaway, FEFO/FIFO picking, SMART PDS + Depot Darpan widgets |

## Scoring logic
**Routing:** `0.30 proximity + 0.25 lead + 0.20 headroom + 0.25 tariff` (min-max normalised). Overflow if nothing fits or best site > 90 % full.

**3PL ranking:**
```
cost  = pallets·days·rate + pallets·handling + pallets·MT/pallet·km·₹3.5
lead  = readyHours + km/35
score = 0.40·costScore + 0.30·leadScore + 0.20·reliability + 0.10·fit
reliability = 0.6·rating/5 + 0.4·onTimeRate     fit = requested / available
```
Hard filters first (dates, commodity, cold, tier ≥ VERIFIED, pallets). No single slot fits → cheapest-first **split** suggestion.

## Run it
```bash
cd server && cp .env.example .env && npm i && npx prisma db push && npm run db:seed && npm run dev
npm run simulate -- --spike     # fake BLE + structural telemetry
cd ../web && npm i && npm run dev   # http://localhost:5391
```
Logins (dev, pw `demo1234`): admin@cwc.local · manager@cwc.local · partner@banas.local · auditor@cwc.local

## Verified so far
- 11 unit tests (routing + ranking) pass; both packages typecheck; web builds.
- Smoke-tested: route 20,000 MT → 4,470 MT overflow; rank 3PLs; hold booking; over-booking rejected (409); putaway; FEFO pick; twin state with simulator.
- Not yet browser-tested visually (map, 3D twin).

## Open questions
- Real **SMART PDS / Depot Darpan** access — who at CWC owns API specs/credentials?
- Auth: local JWT now; government **SSO** later?
- Actual CWC/GSWC Gujarat warehouse list and tariffs (Depot Darpan export?)
- Which BLE/twin vendor, and what is the real "8D" feed format?
- Pallet↔MT conversion and potato storage share (35 % assumed) for surge estimate.

## Next
1. Click-through the UI in a browser and fix layout issues.
2. Real data load + tariff validation with CWC.
3. Trilateration for BLE; per-gateway keys; rate limiting.
4. Truck check-in module (see [[#Scope decisions]]).

Links: [[CWC]] · [[Flexe model]] · [[Depot Darpan]] · [[SMART PDS]]
