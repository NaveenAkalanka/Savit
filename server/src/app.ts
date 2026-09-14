import fs from 'node:fs';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import type { Client } from '@libsql/client';
import type {
  ChangeEmailInput,
  ChangePasswordInput,
  CreateLinkInput,
  ListLinksQuery,
  LoginInput,
  SignupInput,
  UpdateLinkInput,
  User,
} from '@savit/shared';
import type { Config } from './config.ts';
import {
  archiveLink,
  createLink,
  deleteLink,
  getLink,
  listArchived,
  listCategories,
  listLinks,
  listTrash,
  purgeExpiredTrash,
  purgeLink,
  refreshScreenshot,
  restoreLink,
  TRASH_RETENTION_DAYS,
  unarchiveLink,
  updateLink,
} from './links.ts';
import { createSection, deleteSection, listSections, updateSection } from './sections.ts';
import {
  changeEmail,
  changePassword,
  getUserForToken,
  login,
  logout,
  logoutOtherSessions,
  signup,
  SESSION_COOKIE,
} from './auth.ts';
import { HttpError, toApiError } from './errors.ts';
import { createSsrRenderer, type SsrRenderer } from './ssr.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id)) {
    throw new HttpError(400, 'INVALID_INPUT', `Invalid id: ${raw}`);
  }
  return id;
}

function requireUser(req: FastifyRequest): User {
  if (!req.user) throw new HttpError(401, 'UNAUTHORIZED', 'Not signed in');
  return req.user;
}

async function buildInitialData(db: Client, rawUrl: string, user: User | null) {
  const url = new URL(rawUrl, 'http://internal');

  if (!user) {
    return { kind: 'auth' as const };
  }

  if (url.pathname === '/save') {
    return {
      kind: 'save' as const,
      url: url.searchParams.get('url') ?? '',
      title: url.searchParams.get('title') ?? '',
      image: url.searchParams.get('image') ?? '',
      categories: await listCategories(db, user.id),
    };
  }

  if (url.pathname === '/settings') {
    const [categories, sections] = await Promise.all([listCategories(db, user.id), listSections(db, user.id)]);
    return { kind: 'settings' as const, user, categories, sections };
  }
  const listQuery: ListLinksQuery = {
    q: url.searchParams.get('q') ?? undefined,
    category: url.searchParams.get('category') ?? undefined,
    sort: url.searchParams.get('sort') === 'oldest' ? 'oldest' : 'newest',
  };
  const [links, categories] = await Promise.all([
    listLinks(db, user.id, listQuery),
    listCategories(db, user.id),
  ]);
  return { kind: 'dashboard' as const, user, links, categories };
}

export async function buildApp(
  config: Config,
  db: Client,
  ssrRendererOverride?: SsrRenderer,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(fastifyCookie);

  // Registered with global:false — nothing is rate-limited by default. Only
  // routes that opt in via `config: { rateLimit: {...} }` (signup/login,
  // below) are affected.
  await app.register(fastifyRateLimit, {
    global: false,
    errorResponseBuilder: (_req, context) =>
      new HttpError(429, 'RATE_LIMITED', `Too many attempts, try again in ${context.after}`),
  });

  app.decorateRequest('user', null);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    if (config.staticDir) {
      reply.header(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
      );
    }
    req.user = await getUserForToken(db, req.cookies[SESSION_COOKIE]);
  });

  // Every /api/* route requires a signed-in user, except the auth routes
  // themselves and the health check.
  app.addHook('preHandler', async (req) => {
    if (!req.raw.url?.startsWith('/api')) return;
    if (req.raw.url.startsWith('/api/auth/') || req.raw.url === '/api/health') return;
    requireUser(req);
  });

  const isSecureCookie = false; // this app is designed to also run over plain http on a LAN — see run.bat

  app.get('/api/health', async () => ({ ok: true }));

  app.post<{ Body: SignupInput }>(
    '/api/auth/signup',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { user, token } = await signup(db, req.body?.email ?? '', req.body?.password ?? '');
      reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureCookie });
      reply.code(201);
      return user;
    },
  );

  app.post<{ Body: LoginInput }>(
    '/api/auth/login',
    { config: { rateLimit: { max: 10, timeWindow: '10 minutes' } } },
    async (req, reply) => {
      const { user, token } = await login(db, req.body?.email ?? '', req.body?.password ?? '');
      reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureCookie });
      return user;
    },
  );

  app.post('/api/auth/logout', async (req, reply) => {
    await logout(db, req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { loggedOut: true };
  });

  app.get('/api/auth/me', async (req) => req.user);

  app.post('/api/auth/logout-others', async (req) => {
    const userId = requireUser(req).id;
    await logoutOtherSessions(db, userId, req.cookies[SESSION_COOKIE]);
    return { loggedOut: true };
  });

  app.patch<{ Body: ChangePasswordInput }>('/api/auth/password', async (req, reply) => {
    const userId = requireUser(req).id;
    await changePassword(db, userId, req.body?.currentPassword ?? '', req.body?.newPassword ?? '');
    // Password change invalidates every session, this one included — the
    // client re-signs-in with the new password right after.
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { changed: true };
  });

  app.patch<{ Body: ChangeEmailInput }>('/api/auth/email', async (req) => {
    const userId = requireUser(req).id;
    return changeEmail(db, userId, req.body?.currentPassword ?? '', req.body?.newEmail ?? '');
  });

  app.post<{ Body: CreateLinkInput }>('/api/links', async (req, reply) => {
    const link = await createLink(db, requireUser(req).id, req.body);
    reply.code(201);
    return link;
  });

  app.get<{ Querystring: ListLinksQuery }>('/api/links', async (req) => {
    return { links: await listLinks(db, requireUser(req).id, req.query) };
  });

  app.get<{ Params: { id: string } }>('/api/links/:id', async (req) => {
    const id = parseId(req.params.id);
    const link = await getLink(db, requireUser(req).id, id);
    if (!link) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
    return link;
  });

  app.patch<{ Params: { id: string }; Body: UpdateLinkInput }>('/api/links/:id', async (req) => {
    return updateLink(db, requireUser(req).id, parseId(req.params.id), req.body);
  });

  app.delete<{ Params: { id: string } }>('/api/links/:id', async (req) => {
    return deleteLink(db, requireUser(req).id, parseId(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/links/:id/refresh-screenshot', async (req) => {
    return refreshScreenshot(db, requireUser(req).id, parseId(req.params.id));
  });

  app.get('/api/archive', async (req) => ({ links: await listArchived(db, requireUser(req).id) }));

  app.post<{ Params: { id: string } }>('/api/links/:id/archive', async (req) => {
    return archiveLink(db, requireUser(req).id, parseId(req.params.id));
  });

  app.post<{ Params: { id: string } }>('/api/links/:id/unarchive', async (req) => {
    return unarchiveLink(db, requireUser(req).id, parseId(req.params.id));
  });

  app.get('/api/trash', async (req) => {
    const userId = requireUser(req).id;
    await purgeExpiredTrash(db);
    return { links: await listTrash(db, userId), retentionDays: TRASH_RETENTION_DAYS };
  });

  app.post<{ Params: { id: string } }>('/api/links/:id/restore', async (req) => {
    return restoreLink(db, requireUser(req).id, parseId(req.params.id));
  });

  app.delete<{ Params: { id: string } }>('/api/trash/:id', async (req) => {
    return purgeLink(db, requireUser(req).id, parseId(req.params.id));
  });

  app.get('/api/categories', async (req) => ({ categories: await listCategories(db, requireUser(req).id) }));

  app.get('/api/sections', async (req) => ({ sections: await listSections(db, requireUser(req).id) }));

  app.post<{ Body: { name: string } }>('/api/sections', async (req, reply) => {
    const section = await createSection(db, requireUser(req).id, req.body?.name ?? '');
    reply.code(201);
    return section;
  });

  app.patch<{ Params: { id: string }; Body: { name: string } }>('/api/sections/:id', async (req) => {
    return updateSection(db, requireUser(req).id, parseId(req.params.id), req.body?.name ?? '');
  });

  app.delete<{ Params: { id: string }; Body: { reassignTo?: string } | undefined }>(
    '/api/sections/:id',
    async (req) => {
      return deleteSection(db, requireUser(req).id, parseId(req.params.id), req.body?.reassignTo);
    },
  );

  const ssrRenderer = ssrRendererOverride ?? (await createSsrRenderer(config));

  if (config.staticDir && fs.existsSync(config.staticDir)) {
    await app.register(fastifyStatic, {
      root: config.staticDir,
      wildcard: false,
      index: false, // '/' must fall through to the SSR notFoundHandler below, not raw index.html
    });
  }

  if (ssrRenderer.attachMiddleware) {
    await ssrRenderer.attachMiddleware(app);
  }

  app.setNotFoundHandler(async (req, reply) => {
    if (req.raw.url?.startsWith('/api')) {
      throw new HttpError(404, 'NOT_FOUND', 'Not found');
    }
    const initialData = await buildInitialData(db, req.raw.url ?? '/', req.user);
    const html = await ssrRenderer.renderPage(req.raw.url ?? '/', initialData);
    reply.header('Content-Type', 'text/html');
    return reply.send(html);
  });

  app.setErrorHandler((err, _req, reply) => {
    if (!(err instanceof HttpError)) {
      app.log.error(err);
    }
    const { status, body } = toApiError(err);
    reply.status(status).send(body);
  });

  return app;
}
