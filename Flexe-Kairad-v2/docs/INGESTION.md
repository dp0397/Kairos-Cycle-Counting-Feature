# SKU ingestion (v2, Phase 1)

Replaces "upload a CSV and have an engineer vet it" with automatic mapping, validation and de-duplication.
Rows that pass go straight into the SKU master; rows that fail wait in an exception inbox that an operations user can clear.

## Rules

Every SKU needs:

| Field | Rule |
| --- | --- |
| SKU name | not blank |
| Description | not blank |
| Quantity | number, 0 or more |
| Unit of measure | Eaches, Pallets, Cartons or Sacks (also reads ea, pcs, ctn, case, bag, plt ...) |
| Pack data | **Pallet item:** Ti and Hi (1 or more each) and units per pallet. **Bin item:** units per bin |
| Stackable | yes / no. When yes, the number of units allowed to stack is required |

Optional: warehouse, location, SKU code / barcode, OEM, manufacturer, weekly demand. Any other column is kept as a custom attribute.

What the engine fixes by itself (shown as "auto-fixed"): `10x5`, `10 X 5`, `TI 10 HI 5` read as Ti 10 / Hi 5; units per pallet worked out
from Ti × Hi (or Ti / Hi worked out from units per pallet); `12 cs` split into quantity and unit; pallet vs bin inferred from the
columns present; stackable inferred from a stack limit; exact duplicate rows dropped.

What it holds for a person: missing mandatory values, unreadable numbers, unknown units, a stack limit on a "do not stack" SKU,
the same SKU + warehouse + location twice with different values, and (server only) a warehouse name that is not set up.
It warns, without holding, on Ti × Hi that disagrees with units per pallet, and on near-duplicates that differ only by punctuation or spacing.

Duplicate identity = SKU name + warehouse + location (case and spacing ignored), the same rule the app already used.

## Where the code is

| File | What it is |
| --- | --- |
| `shared/skuIngest.ts` | The engine: header mapping, row rules, duplicates. Pure TypeScript, used by both the browser and the server |
| `web/src/features/inventory/IngestPanel.tsx` | CSV import card: mapping view, whole-file defaults, inbox with inline fixes, import, held-rows download |
| `web/src/features/inventory/MasterDataPage.tsx` | Add / edit form (same rules), SKU table with pack and stacking columns |
| `server/src/services/skuIngestService.ts` | Runs the engine against Postgres: upsert SKUs, log runs and rows, resolve / reject inbox records |
| `server/src/routes/ingestion.ts` | HTTP API (below) |
| `server/prisma/schema.prisma` | `Sku` gains pack / stack / custom fields; new `IngestionRun`, `StagingRecord` |

## Column matching

1. Exact match on a synonym list (`MATNR`, `Qty On Hand`, `Ti x Hi`, `Stack Flag` ...), ignoring case and punctuation.
2. Otherwise a fuzzy match (0.82 or better similarity), shown as "guessed" so a person can see it.
3. Otherwise the column is kept as a custom attribute.

This step is deterministic. An LLM-assisted mapper can sit behind it for columns that fail all three; it is not built yet.

## API (needs a CWC_ADMIN or REGIONAL_MGR token)

```
POST /api/v1/ingestion/preview   dry run; nothing written
POST /api/v1/ingestion/runs      writes ready rows, holds the rest
POST /api/v1/ingestion/batch     JSON rows pushed from an ERP or iPaaS
GET  /api/v1/ingestion/runs      history       GET /ingestion/runs/:id   detail
GET  /api/v1/ingestion/inbox     held rows
POST /api/v1/ingestion/records/:id/resolve   {"fields": {"hi": "5"}}
POST /api/v1/ingestion/records/:id/reject
GET  /api/v1/skus?q=&warehouseId=
```

```bash
# raw CSV, with a default for a column the file lacks
curl -X POST "http://localhost:4392/api/v1/ingestion/runs?filename=sap.csv&default_isStackable=no" \
  -H "authorization: Bearer $TOKEN" -H "content-type: text/csv" --data-binary @docs/sample-erp-export-sap-style.csv

# JSON push
curl -X POST http://localhost:4392/api/v1/ingestion/batch -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"rows":[{"Material":"M1","Description":"Bolt","Qty":50,"UoM":"EA","unitsPerBin":100,"Stackable":"N"}]}'
```

The plan called this endpoint `skus:batch`; it is `ingestion/batch` here because `:` is reserved in Fastify route paths.

## Try it

`docs/sample-erp-export-sap-style.csv` is a deliberately messy file: SAP-style headers, a duplicate row, `12 cs`, a missing stackable flag,
a stackable SKU with no stack limit, and a quantity of "five hundred". On the Master data page it should read as 5 ready, 4 held,
1 duplicate dropped, and all four held rows can be fixed inline. `docs/sample-master-data.csv` is the clean template.

## Known limits in this phase

- The web app still keeps its SKU master in browser storage (as v1 did). The server API and tables exist and are tested, but the
  screens are not yet wired to them, so SKUs imported in the browser are not in Postgres, and vice versa.
- Stock quantity currently arrives in the same file as the SKU data. The plan is to move it to a separate, more frequent inventory feed.
- `Sku.code` is still unique across the whole table, so two clients cannot yet share a SKU code. Add a client key first.
- No scheduled connectors (SFTP, ERP APIs, EDI) or LLM mapping yet; those are Phases 2 and 3 of the plan.
- The server code has only been exercised with an in-memory fake database. Run the steps below against a real Postgres before relying on it.

## Running v2 beside v1

v2 uses its own ports and database so both can run at once: web 5392, API 4392, Postgres 5492 (database `flexe_kairad_v2`).

```bash
docker compose up -d
cd server && npm install && npx prisma db push && npm run db:seed && npm run dev
cd web && npm install --legacy-peer-deps && npm run dev     # http://localhost:5392, sign in with the seeded admin
cd server && npm test
```
