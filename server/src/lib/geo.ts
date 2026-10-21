const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Road distance estimate. Swap for an OSRM/GraphHopper call without touching callers. */
export const ROAD_CIRCUITY = 1.3;
export function roadKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return haversineKm(aLat, aLng, bLat, bLng) * ROAD_CIRCUITY;
}

/** Min-max normalise to 0..1 where higher input => higher output. Degenerate range => 1 for all. */
export function normalizeHigh(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 1);
  return values.map((v) => (v - min) / (max - min));
}

/** Min-max normalise where LOWER input is better (cost, distance, lead time). */
export function normalizeLow(values: number[]): number[] {
  return normalizeHigh(values).map((s) => (values.length ? 1 - s : s));
}
