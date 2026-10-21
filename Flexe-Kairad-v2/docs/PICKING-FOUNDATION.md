# From cycle counts to picking algorithms: data foundation

Cycle counting (step 2) is the cheapest, most frequent way to capture trustworthy location and SKU data. Everything below is already captured by the app so that slotting and pick-path algorithms can be built on it.

| Data | Where it comes from | Used later for |
|---|---|---|
| Location tag (`DEE-A-01-01`) and SKU tag/barcode | Master data; scanned on the Zebra | Confirming the right SKU is in the right bin (SKU + location accuracy) |
| Bin walk order (zone-aisle-level) | `routeCompare` in `store.tsx` | Count walk path now; pick-path sequencing later |
| Weekly demand and A/B/C velocity | Master data `weekly_demand` | Count frequency now (A 7d, B 14d, C 30d); slotting fast movers near dispatch later |
| Timestamped scan events (location, SKU, qty, errors) | Step 2 handheld and CSV loads; exportable as CSV | Seconds per line and travel time, i.e. labour standards for pick-time models |
| Count method per count (handheld / CSV / manual) | Job record | Comparing accuracy and speed by method |
| Found-stock lines (SKU present where system had none) | Handheld scan of an unexpected SKU | Detecting mis-slotting and put-away errors |

## Suggested next steps
1. Add bin attributes to master data: x/y coordinates, pick face vs reserve, capacity, cube.
2. Add order-line history per client (SKU, qty, date) to replace the single weekly demand figure; compute pick frequency and co-pick affinity.
3. Slotting engine: rank SKUs by pick frequency (and affinity), assign A-class to golden-zone bins nearest dispatch; output a re-slot move list.
4. Pick-path engine: sequence a wave's pick lines by walk order (serpentine/S-shape first, then optimise with bin coordinates).
5. Move the inventory module from browser storage to API endpoints and the database so counts and scans are shared and auditable across users.
