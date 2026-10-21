import { PrismaClient } from '@prisma/client';
import { EventEmitter } from 'node:events';

export const prisma = new PrismaClient();

export const config = {
  port: Number(process.env.PORT ?? 4391),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-secret',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5391',
  activeStates: (process.env.ACTIVE_STATES ?? 'GJ').split(',').map((s) => s.trim()).filter(Boolean),
  gatewayKey: process.env.GATEWAY_KEY ?? 'dev-gateway-key',
  integrationMode: (process.env.INTEGRATION_MODE ?? 'MOCK') as 'MOCK' | 'LIVE',
};

/**
 * In-process domain event bus. Feeds the SSE stream and is the hook point for
 * future modules (e.g. a driver check-in system subscribing to trailer.* events).
 */
export type DomainEvent =
  | { type: 'telemetry'; warehouseId: string; kind: string; value: number; unit: string; ts: string; sensorId?: string }
  | { type: 'asset.moved'; warehouseId: string; assetId: string; label: string; zone: string | null; x: number | null; y: number | null }
  | { type: 'alert'; warehouseId: string; id: string; severity: string; kind: string; message: string }
  | { type: 'trailer.scheduled' | 'trailer.arrived' | 'trailer.door_assigned' | 'trailer.completed'; warehouseId: string; trailerId: string };

class Bus extends EventEmitter {
  publish(e: DomainEvent) {
    this.emit('event', e);
  }
  subscribe(fn: (e: DomainEvent) => void) {
    this.on('event', fn);
    return () => this.off('event', fn);
  }
}
export const bus = new Bus();
bus.setMaxListeners(200);

export const stateFilter = { stateCode: { in: config.activeStates } };
