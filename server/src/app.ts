import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config, prisma } from './lib/core.js';
import { routingRoutes } from './routes/routing.js';
import { capacityRoutes } from './routes/capacity.js';
import { iotRoutes } from './routes/iot.js';
import { wmsRoutes } from './routes/wms.js';

type JwtUser = { sub: string; role: 'CWC_ADMIN' | 'REGIONAL_MGR' | 'PARTNER_3PL' | 'AUDITOR'; providerId?: string | null };

declare module '@fastify/jwt' {
  interface FastifyJWT { payload: JwtUser; user: JwtUser }
}
declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (req: any, reply: any) => Promise<void>;
    requireRole: (...roles: JwtUser['role'][]) => (req: any, reply: any) => Promise<void>;
  }
}

export async function build() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } });

  await app.register(cors, { origin: config.corsOrigin, credentials: true });
  await app.register(jwt, { secret: config.jwtSecret });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024 } });
  app.addContentTypeParser('text/csv', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  app.decorate('authenticate', async (req: any, reply: any) => {
    try { await req.jwtVerify(); } catch { reply.code(401).send({ error: 'unauthorized' }); }
  });
  app.decorate('requireRole', (...roles: JwtUser['role'][]) => async (req: any, reply: any) => {
    if (!roles.includes(req.user.role)) reply.code(403).send({ error: 'forbidden' });
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'validation', issues: err.issues });
    app.log.error(err);
    reply.code(err.statusCode ?? 500).send({ error: err.message });
  });

  app.get('/health', async () => ({ ok: true, activeStates: config.activeStates, integrationMode: config.integrationMode }));

  app.register(async (api) => {
    api.post('/auth/login', async (req, reply) => {
      const b = z.object({ email: z.string().email(), password: z.string() }).parse(req.body);
      const u = await prisma.user.findUnique({ where: { email: b.email } });
      if (!u || !(await bcrypt.compare(b.password, u.passwordHash))) return reply.code(401).send({ error: 'invalid credentials' });
      const token = api.jwt.sign({ sub: u.id, role: u.role, providerId: u.providerId }, { expiresIn: '12h' });
      return { token, user: { id: u.id, name: u.name, email: u.email, role: u.role } };
    });
    api.get('/config', { preHandler: [app.authenticate] }, async () => ({ activeStates: config.activeStates, integrationMode: config.integrationMode }));

    await api.register(routingRoutes);
    await api.register(capacityRoutes);
    await api.register(iotRoutes);
    await api.register(wmsRoutes);
  }, { prefix: '/api/v1' });

  return app;
}

if (process.env.VITEST === undefined) {
  build().then((app) => app.listen({ port: config.port, host: '0.0.0.0' })).catch((e) => { console.error(e); process.exit(1); });
}
