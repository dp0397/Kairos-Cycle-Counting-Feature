import { prisma } from '../lib/core.js';

/**
 * System-directed putaway. Rules, in order:
 *   1. Zone must fit the quantity (free MT) and match cold requirement.
 *   2. Prefer zones whose commodityAffinity includes the commodity.
 *   3. Among those, consolidate: choose the *fullest* zone that still fits
 *      (keeps other zones free for large lots and shortens pick paths).
 */
export async function suggestPutaway(warehouseId: string, commodity: string, mt: number, needCold = false) {
  const zones = await prisma.zone.findMany({ where: { warehouseId } });
  const fits = zones.filter((z) => z.capacityMT - z.usedMT >= mt && (!needCold || z.cold));
  if (!fits.length) return null;
  const affine = fits.filter((z) => z.commodityAffinity.includes(commodity));
  const pool = affine.length ? affine : fits;
  pool.sort((a, b) => b.usedMT / b.capacityMT - a.usedMT / a.capacityMT);
  const zone = pool[0];
  const reason = `${affine.length ? 'Commodity-affine' : 'Any-fit'} zone; ${(zone.capacityMT - zone.usedMT).toFixed(0)} MT free, consolidating at ${((zone.usedMT / zone.capacityMT) * 100).toFixed(0)}% full`;
  return { zone, reason };
}

/** Rule-driven picking: first active rule (lowest priority number) matching the commodity wins. */
export async function generatePick(warehouseId: string, orderRef: string, commodity: string, mt: number) {
  const rules = await prisma.pickRule.findMany({
    where: { warehouseId, active: true, OR: [{ commodity: null }, { commodity }] },
    orderBy: { priority: 'asc' },
  });
  const rule = rules[0];
  const strategy = rule?.strategy ?? 'FIFO';

  const lots = await prisma.inventoryLot.findMany({
    where: { warehouseId, commodity, mt: { gt: 0 } },
    include: { zone: true },
  });
  const sorted = [...lots].sort((a, b) => {
    if (strategy === 'FEFO') {
      const ea = a.expiryAt?.getTime() ?? Infinity;
      const eb = b.expiryAt?.getTime() ?? Infinity;
      if (ea !== eb) return ea - eb;
    }
    if (strategy === 'ZONE_FIRST') {
      const za = a.zone.code.localeCompare(b.zone.code);
      if (za) return za;
    }
    return a.receivedAt.getTime() - b.receivedAt.getTime();
  });

  let left = mt;
  const lines: { lotId: string; zone: string; mt: number }[] = [];
  for (const lot of sorted) {
    if (left <= 0) break;
    const take = Math.min(left, lot.mt);
    lines.push({ lotId: lot.id, zone: lot.zone.code, mt: take });
    left -= take;
  }
  if (left > 0) return { error: `Only ${(mt - left).toFixed(1)} MT of ${commodity} available`, lines } as const;

  const task = await prisma.pickTask.create({
    data: { warehouseId, orderRef, commodity, mt, ruleName: rule?.name ?? 'Default FIFO', lines },
  });
  return { task } as const;
}
