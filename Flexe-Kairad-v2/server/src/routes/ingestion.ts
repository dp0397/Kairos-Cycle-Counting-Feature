import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/core.js';
import { FIELDS, objectsToTable, parseCsv, type Canon, type Field } from '../../../shared/skuIngest.js';
import { cleanFields, rejectRecord, resolveRecord, runIngestion, type Db } from '../services/skuIngestService.js';

const db = prisma as unknown as Db;

const body = z.object({
  csv: z.string().min(1).optional(),
  rows: z.array(z.record(z.unknown())).min(1).max(20_000).optional(),
  defaults: z.record(z.string()).optional(),
  filename: z.string().optional(),
  source: z.string().default('CSV'),
}).refine((b) => b.csv || b.rows, { message: 'send csv (text) or rows (array of objects)' });

/**
 * SKU ingestion API (v2).
 *   POST /ingestion/preview    dry run: mapping, per-row status and issues, nothing written
 *   POST /ingestion/runs       same, then writes ready rows to the SKU master and holds the rest in the inbox
 *   POST /ingestion/batch      JSON rows from an ERP / iPaaS push (source defaults to API)
 *   GET  /ingestion/runs[/:id] run history and detail
 *   GET  /ingestion/inbox      held rows awaiting a person
 *   POST /ingestion/records/:id/resolve  { fields: { hi: "5" } } re-validates; writes the SKU when valid
 *   POST /ingestion/records/:id/reject
 * A raw CSV can also be posted with content-type text/csv; ?filename=, ?source= and ?default_<field>=value apply.
 */
export async function ingestionRoutes(app: FastifyInstance) {
  const ops = { preHandler: [app.authenticate, app.requireRole('CWC_ADMIN', 'REGIONAL_MGR')] };

  function parse(req: any, defaultSource: string) {
    if (typeof req.body === 'string') {
      const defaults: Canon = {};
      const q = (req.query ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(q)) if (k.startsWith('default_') && (FIELDS as readonly string[]).includes(k.slice(8))) defaults[k.slice(8) as Field] = String(v);
      return { table: parseCsv(req.body), defaults, filename: q.filename, source: q.source ?? defaultSource };
    }
    const b = body.parse(req.body);
    return { table: b.csv ? parseCsv(b.csv) : objectsToTable(b.rows as Record<string, unknown>[]), defaults: b.defaults as Canon | undefined, filename: b.filename, source: b.rows && !b.csv ? 'API' : b.source };
  }

  app.post('/ingestion/preview', ops, async (req) => {
    const p = parse(req, 'CSV');
    return runIngestion(db, { ...p, dryRun: true });
  });

  app.post('/ingestion/runs', ops, async (req, reply) => {
    const p = parse(req, 'CSV');
    const out = await runIngestion(db, { ...p, userId: (req.user as any)?.sub });
    return reply.code(201).send(out);
  });

  app.post('/ingestion/batch', ops, async (req, reply) => {
    const p = parse(req, 'API');
    const out = await runIngestion(db, { ...p, source: p.source || 'API', userId: (req.user as any)?.sub });
    return reply.code(201).send(out);
  });

  app.get('/ingestion/runs', ops, async () => db.ingestionRun.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }));

  app.get('/ingestion/runs/:id', ops, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const run = await db.ingestionRun.findUnique({ where: { id } });
    if (!run) return reply.code(404).send({ error: 'run not found' });
    const records = await db.stagingRecord.findMany({ where: { runId: id }, orderBy: { rowNumber: 'asc' }, take: 5000 });
    return { run, records };
  });

  app.get('/ingestion/inbox', ops, async (req) => {
    const q = z.object({ runId: z.string().optional(), take: z.coerce.number().int().min(1).max(1000).default(300) }).parse(req.query);
    const records = await db.stagingRecord.findMany({ where: { status: 'HELD', ...(q.runId ? { runId: q.runId } : {}) }, orderBy: [{ runId: 'desc' }, { rowNumber: 'asc' }], take: q.take });
    return { count: records.length, records };
  });

  app.post('/ingestion/records/:id/resolve', ops, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const b = z.object({ fields: z.record(z.string()) }).parse(req.body);
    return resolveRecord(db, id, cleanFields(b.fields), (req.user as any)?.sub);
  });

  app.post('/ingestion/records/:id/reject', ops, async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    return rejectRecord(db, id, (req.user as any)?.sub);
  });

  // Read side for the SKU master (the v1 server had no SKU endpoint).
  app.get('/skus', { preHandler: [app.authenticate] }, async (req) => {
    const q = z.object({ q: z.string().optional(), warehouseId: z.string().optional(), take: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return (db as any as typeof prisma).sku.findMany({
      where: { ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}), ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}) },
      orderBy: [{ name: 'asc' }, { locationCode: 'asc' }], take: q.take, include: { warehouse: { select: { name: true, code: true } } },
    });
  });
}
