# Flexe x Kairad, version 2

A copy of the original Flexe-Kairad app with SKU ingestion added: automatic column mapping, validation, de-duplication and an
exception inbox for SKU and inventory master data. The original folder is untouched.

- What changed and how it works: `docs/INGESTION.md`
- Ports (so it can run beside v1): web 5392, API 4392, Postgres 5492
- Start: see "Running v2 beside v1" in `docs/INGESTION.md`
- Everything else (capacity, routing, tracking, WMS, cycle counts) is as in v1; see `docs/ARCHITECTURE.md`
