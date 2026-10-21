import { config, prisma, stateFilter } from '../lib/core.js';

/**
 * External-system adapters. Each has a MOCK implementation (default) and a LIVE stub
 * that throws until real endpoints/credentials exist — nothing here assumes a public API.
 */

export interface SmartPdsSummary {
  state: string;
  month: string;
  foodgrainAllocatedMT: number;
  foodgrainLiftedMT: number;
  fpsReporting: number;
  fpsTotal: number;
  stockAtCwcDepotsMT: number;
  asOf: string;
}

export interface DepotDarpanSummary {
  depotsRegistered: number;
  depotsMapped: number;
  capacityMT: number;
  storedMT: number;
  occupancyPct: number;
  mismatches: { code: string; name: string; reason: string }[];
  asOf: string;
}

export interface IntegrationAdapter<T> {
  readonly system: 'SMART_PDS' | 'DEPOT_DARPAN';
  readonly mode: 'MOCK' | 'LIVE';
  fetchSummary(): Promise<T>;
}

class MockSmartPds implements IntegrationAdapter<SmartPdsSummary> {
  system = 'SMART_PDS' as const;
  mode = 'MOCK' as const;
  async fetchSummary(): Promise<SmartPdsSummary> {
    const stock = await prisma.warehouse.aggregate({
      where: { ...stateFilter, kind: { in: ['CWC', 'SWC'] } },
      _sum: { usedMT: true },
    });
    // Illustrative figures, deterministic per month so the widget doesn't flicker.
    return {
      state: config.activeStates.join(','),
      month: new Date().toISOString().slice(0, 7),
      foodgrainAllocatedMT: 112_400,
      foodgrainLiftedMT: 98_760,
      fpsReporting: 16_904,
      fpsTotal: 17_800,
      stockAtCwcDepotsMT: Math.round(stock._sum.usedMT ?? 0),
      asOf: new Date().toISOString(),
    };
  }
}

class MockDepotDarpan implements IntegrationAdapter<DepotDarpanSummary> {
  system = 'DEPOT_DARPAN' as const;
  mode = 'MOCK' as const;
  async fetchSummary(): Promise<DepotDarpanSummary> {
    const wh = await prisma.warehouse.findMany({ where: { ...stateFilter, kind: { in: ['CWC', 'SWC'] } } });
    const mapped = wh.filter((w) => w.depotDarpanId);
    const cap = mapped.reduce((s, w) => s + w.capacityMT, 0);
    const used = mapped.reduce((s, w) => s + w.usedMT, 0);
    return {
      depotsRegistered: wh.length,
      depotsMapped: mapped.length,
      capacityMT: Math.round(cap),
      storedMT: Math.round(used),
      occupancyPct: cap ? Math.round((used / cap) * 1000) / 10 : 0,
      mismatches: wh
        .filter((w) => !w.depotDarpanId)
        .map((w) => ({ code: w.code, name: w.name, reason: 'No Depot Darpan ID mapped' })),
      asOf: new Date().toISOString(),
    };
  }
}

class LiveStub<T> implements IntegrationAdapter<T> {
  mode = 'LIVE' as const;
  constructor(public system: 'SMART_PDS' | 'DEPOT_DARPAN') {}
  async fetchSummary(): Promise<T> {
    throw new Error(`${this.system} LIVE adapter not configured: endpoint and credentials required`);
  }
}

export const smartPds: IntegrationAdapter<SmartPdsSummary> =
  config.integrationMode === 'LIVE' ? new LiveStub('SMART_PDS') : new MockSmartPds();
export const depotDarpan: IntegrationAdapter<DepotDarpanSummary> =
  config.integrationMode === 'LIVE' ? new LiveStub('DEPOT_DARPAN') : new MockDepotDarpan();

/** Run an adapter, persist the outcome, return the payload (or throw after logging). */
export async function syncAdapter<T>(a: IntegrationAdapter<T>): Promise<T> {
  try {
    const payload = await a.fetchSummary();
    await prisma.integrationSync.create({
      data: { system: a.system, mode: a.mode, status: 'OK', payload: payload as object },
    });
    return payload;
  } catch (e) {
    await prisma.integrationSync.create({
      data: { system: a.system, mode: a.mode, status: 'ERROR', error: (e as Error).message },
    });
    throw e;
  }
}
