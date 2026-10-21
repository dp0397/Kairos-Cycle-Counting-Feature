/**
 * PROVISION ONLY — not implemented, not wired, no routes, no UI.
 *
 * Seam for a COLT-style driver/truck check-in system (the kind North American truckers
 * use to announce arrival at a facility). Phase 1 of the CWC platform deliberately does
 * not include one; this interface exists so that adding it later is additive:
 *
 *   1. Implement TruckCheckInProvider (QR / SMS / kiosk / geofence — vendor's choice).
 *   2. Subscribe to `trailer.scheduled` on the event bus to push expected arrivals out.
 *   3. On arrival, call the existing PATCH /inbound/trailers/:id/status with ARRIVED and fill
 *      the nullable InboundTrailer.checkInMethod / checkInAt / externalRef / carrierId columns.
 *   4. Optionally publish door assignments back via `trailer.door_assigned`.
 *
 * See docs/ARCHITECTURE.md §8.
 */

export interface ArrivalRequest {
  trailerId?: string; // known appointment, if the driver supplied a reference
  plate: string;
  carrierId?: string;
  method: 'QR' | 'SMS' | 'KIOSK' | 'GEOFENCE';
  externalRef?: string;
}

export interface ArrivalResult {
  trailerId: string;
  checkedInAt: Date;
  queuePosition: number;
}

export interface TruckCheckInProvider {
  registerArrival(warehouseId: string, req: ArrivalRequest): Promise<ArrivalResult>;
  getQueuePosition(warehouseId: string, trailerId: string): Promise<number>;
  assignDoor(warehouseId: string, trailerId: string, doorNo: number): Promise<void>;
}
