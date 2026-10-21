# Architecture

## 1. Shape
React/Vite SPA → Fastify REST API (`/api/v1`, JWT + role checks, zod validation) → PostgreSQL via Prisma.
IoT devices post to `/iot/*` with a gateway key; the API fans events out over SSE (`/telemetry/stream`) via an
in-process event bus (`server/src/lib/core.ts`). Single deployable API; swap the bus for Redis/MQTT when scaling out.

```
 BLE gateways ─┐                          ┌─> SSE → Tracking page / 3D twin
 site sensors ─┼─> /iot/ble|telemetry ─> iotService ─> Postgres ─> alerts
 (simulator)  ─┘                          └─> event bus
 Browser ─> routing / capacity / wms routes ─> pure scoring services ─> Postgres
 Adapters: SMART PDS, Depot Darpan (MOCK|LIVE)
```

## 2. Scope: Gujarat first
`ACTIVE_STATES` (default `GJ`) filters every list/aggregate (`stateFilter`) and the map is bounded to Gujarat.
Models carry `stateCode`, so adding a state is data + config, not a migration.

## 3. Capex → opex model
CWC owns fixed capacity (capex). Private 3PL/2PL owners publish dated **CapacitySlots** (pallets, ₹/pallet/day,
handling, readiness). CWC buys pallet-days on demand through **Bookings** (HELD 24 h → CONFIRMED), so surge storage
is a variable cost. Booking writes use a conditional `UPDATE … WHERE palletsBooked <= pallets - n` inside a
transaction, so concurrent bookings can never over-sell a slot.

## 4. Routing engine (`routingService.ts`)
Hard filters: commodity, cold storage, free MT > 0, reachable/ready before `needBy`.
Score = 0.30·proximity + 0.25·lead time + 0.20·post-placement headroom + 0.25·tariff (each min-max normalised,
weights adjustable per request). Greedy split across ranked facilities when no single site fits.
**Overflow** is recommended if nothing fits, the lot can't be fully absorbed, or best site would exceed 90 % utilisation.
Every call is stored in `RoutingRecommendation` with inputs and results for audit.
Distance = haversine × 1.3 circuity (swap in OSRM at `lib/geo.ts → roadKm`).

## 5. 3PL ranking (`rankingService.ts`)
1. Filter: window covers dates, commodity, cold, provider tier ≥ minimum, enough pallets in one slot.
2. cost = pallets·days·rate + pallets·handling + pallets·MT/pallet·km·₹3.5; lead = readyHours + km/35.
3. costScore, leadScore = min-max, lower is better (identical candidates → 1). reliability = 0.6·rating/5 + 0.4·on-time rate.
   fit = requested/available (prefers well-filled slots, less stranded capacity).
4. score = 0.40·cost + 0.30·lead + 0.20·reliability + 0.10·fit (weights auto-normalised). Ties → cheaper.
5. No single slot fits → cheapest-unit-cost greedy **split suggestion** with any shortfall reported.
Scores are *relative to the current candidate set*; the UI shows the per-term breakdown.

## 6. Tracking & twin
BLE tags (PV-cell assisted; `batteryV`, `pvVoltage`) are heard by gateways; the loudest gateway fixes the asset's zone
(replacing cycle counts). Alerts: low storage-cell voltage, no PV harvest, structural sensor warn/critical (de-duplicated 10 min).
`GET /twin/:id/state` returns zones, gateways, sensors (with status), assets, 1 h history — consumed by the three.js viewer and
floor-plan map. The "8D" feed is modelled as 3D position + time + structural telemetry; a vendor twin plugs in behind `/twin`.
Next step for location accuracy: RSSI trilateration when ≥3 gateways hear a tag (hook in `ingestBle`).

## 7. WMS
Inbound trailer state machine `SCHEDULED → ARRIVED → DOCKED → UNLOADING → COMPLETED` (publishes `trailer.*` events).
Putaway: fits + cold → prefer commodity-affine zone → consolidate into the fullest zone that still fits.
Picking: first active rule by priority (FIFO / FEFO / ZONE_FIRST) allocates lots. Gov widgets read via adapters.

## 8. Provision: COLT-style truck check-in (NOT built)
Deliberately excluded from Phase 1. Seams that exist today:
- `InboundTrailer.checkInMethod / checkInAt / externalRef / carrierId` (nullable, unused).
- `server/src/adapters/truckCheckIn.ts` — `TruckCheckInProvider` interface only; nothing implements or imports it.
- `trailer.scheduled | arrived | door_assigned | completed` events on the bus.
To add later: implement the provider, subscribe to `trailer.scheduled`, call the existing status endpoint on arrival,
fill the check-in columns; add a `CheckInEvent` table, driver-facing routes and queue UI at that time.

## 9. Known gaps / next steps
Mock SMART PDS & Depot Darpan (need real specs/credentials) · local JWT auth (swap for government SSO) ·
no PostGIS (plain lat/lng + haversine is enough at this scale) · no rate limiting / per-gateway keys yet (single shared key) ·
OSM public tiles are for demos; use a hosted tile source in production.
