import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyInstance } from 'fastify';
import { createTestDb } from './test-helpers.ts';
import { buildApp } from './app.ts';
import type { Config } from './config.ts';
import type { SsrRenderer } from './ssr.ts';

// app.test.ts targets the API layer, not SSR — a stub renderer keeps these
// tests fast and independent of the client package existing/being built.
const stubSsrRenderer: SsrRenderer = {
  async renderPage() {
    return '<!doctype html><html><body>stub</body></html>';
  },
};

const baseConfig: Config = { port: 0, host: '127.0.0.1', tursoUrl: 'unused' };
let emailCounter = 0;

// Every /api/* route but the auth ones now requires a signed-in session —
// sign up a throwaway account and return its `Cookie` header value (and the
// email used) for subsequent app.inject() calls to reuse.
async function signupAndGetCookie(app: FastifyInstance): Promise<{ cookie: string; email: string }> {
  emailCounter += 1;
  const email = `test-${emailCounter}@example.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: { email, password: 'password123' },
  });
  assert.equal(res.statusCode, 201);
  const setCookie = res.headers['set-cookie'];
  const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const cookie = raw?.split(';')[0];
  if (!cookie) throw new Error('signup did not set a session cookie');
  return { cookie, email };
}

test('GET /api/health', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true });
    await app.close();
  } finally {
    await cleanup();
  }
});

test('protected routes 401 without a session', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const res = await app.inject({ method: 'GET', url: '/api/links' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'UNAUTHORIZED');
    await app.close();
  } finally {
    await cleanup();
  }
});

test('signup -> me -> logout -> me is signed out again', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie, email } = await signupAndGetCookie(app);

    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(meRes.json().email, email);

    const logoutRes = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    assert.deepEqual(logoutRes.json(), { loggedOut: true });

    const meAfterRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(meAfterRes.json(), null);

    await app.close();
  } finally {
    await cleanup();
  }
});

test('signup rejects a duplicate email and login rejects a wrong password', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);

    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'dup@example.com', password: 'password123' },
    });
    const dupRes = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'dup@example.com', password: 'password123' },
    });
    assert.equal(dupRes.statusCode, 409);

    const badLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'dup@example.com', password: 'wrong-password' },
    });
    assert.equal(badLoginRes.statusCode, 401);
    assert.equal(badLoginRes.json().code, 'UNAUTHORIZED');

    await app.close();
  } finally {
    await cleanup();
  }
});

test('change password: wrong current password rejected, right one invalidates the session', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie, email } = await signupAndGetCookie(app);

    const wrongRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { currentPassword: 'not-it', newPassword: 'newpassword123' },
    });
    assert.equal(wrongRes.statusCode, 401);

    const okRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/password',
      headers: { cookie },
      payload: { currentPassword: 'password123', newPassword: 'newpassword123' },
    });
    assert.deepEqual(okRes.json(), { changed: true });

    // the old session is dead now — even though we're still sending the same cookie
    const meAfter = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(meAfter.json(), null);

    // old password no longer works, new one does
    const oldLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password123' },
    });
    assert.equal(oldLogin.statusCode, 401);

    const newLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'newpassword123' },
    });
    assert.equal(newLogin.statusCode, 200);

    await app.close();
  } finally {
    await cleanup();
  }
});

test('change email: wrong password rejected, duplicate target rejected, otherwise updates and keeps the session', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie: cookieA } = await signupAndGetCookie(app);
    const { email: emailB } = await signupAndGetCookie(app);

    const wrongRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/email',
      headers: { cookie: cookieA },
      payload: { currentPassword: 'not-it', newEmail: 'new-address@example.com' },
    });
    assert.equal(wrongRes.statusCode, 401);

    const dupRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/email',
      headers: { cookie: cookieA },
      payload: { currentPassword: 'password123', newEmail: emailB },
    });
    assert.equal(dupRes.statusCode, 409);

    const okRes = await app.inject({
      method: 'PATCH',
      url: '/api/auth/email',
      headers: { cookie: cookieA },
      payload: { currentPassword: 'password123', newEmail: 'new-address@example.com' },
    });
    assert.equal(okRes.json().email, 'new-address@example.com');

    // session survives an email change — no re-login needed
    const meRes = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieA } });
    assert.equal(meRes.json().email, 'new-address@example.com');

    await app.close();
  } finally {
    await cleanup();
  }
});

test('create -> list -> get -> patch -> delete -> 404', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie } = await signupAndGetCookie(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/links',
      headers: { cookie },
      payload: { url: 'https://example.com/a', title: 'A' },
    });
    assert.equal(createRes.statusCode, 201);
    const link = createRes.json();
    assert.equal(link.origin, 'https://example.com');

    const listRes = await app.inject({ method: 'GET', url: '/api/links', headers: { cookie } });
    assert.equal(listRes.json().links.length, 1);

    const getRes = await app.inject({ method: 'GET', url: `/api/links/${link.id}`, headers: { cookie } });
    assert.equal(getRes.statusCode, 200);

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/links/${link.id}`,
      headers: { cookie },
      payload: { note: 'noted' },
    });
    assert.equal(patchRes.json().note, 'noted');

    const deleteRes = await app.inject({ method: 'DELETE', url: `/api/links/${link.id}`, headers: { cookie } });
    assert.deepEqual(deleteRes.json(), { id: link.id, deleted: true });

    const missingRes = await app.inject({ method: 'GET', url: `/api/links/${link.id}`, headers: { cookie } });
    assert.equal(missingRes.statusCode, 404);
    assert.equal(missingRes.json().code, 'NOT_FOUND');

    await app.close();
  } finally {
    await cleanup();
  }
});

test('POST /api/links 400s on a missing url', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie } = await signupAndGetCookie(app);
    const res = await app.inject({ method: 'POST', url: '/api/links', headers: { cookie }, payload: {} });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'INVALID_INPUT');
    await app.close();
  } finally {
    await cleanup();
  }
});

test('refresh-screenshot changes the image_url and 404s on a missing/foreign link', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie: cookieA } = await signupAndGetCookie(app);
    const { cookie: cookieB } = await signupAndGetCookie(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/links',
      headers: { cookie: cookieA },
      payload: { url: 'https://example.com/refresh-me', title: 'A' },
    });
    const link = createRes.json();

    const refreshRes = await app.inject({
      method: 'POST',
      url: `/api/links/${link.id}/refresh-screenshot`,
      headers: { cookie: cookieA },
    });
    assert.equal(refreshRes.statusCode, 200);
    assert.notEqual(refreshRes.json().imageUrl, link.imageUrl);

    const foreignRes = await app.inject({
      method: 'POST',
      url: `/api/links/${link.id}/refresh-screenshot`,
      headers: { cookie: cookieB },
    });
    assert.equal(foreignRes.statusCode, 404);

    await app.close();
  } finally {
    await cleanup();
  }
});

test('archive: hides links from the default list, shows in /api/archive, unarchive reverses it', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie } = await signupAndGetCookie(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/links',
      headers: { cookie },
      payload: { url: 'https://example.com/archive-me', title: 'A' },
    });
    const link = createRes.json();

    const archiveRes = await app.inject({
      method: 'POST',
      url: `/api/links/${link.id}/archive`,
      headers: { cookie },
    });
    assert.equal(archiveRes.json().status, 'archived');

    const listRes = await app.inject({ method: 'GET', url: '/api/links', headers: { cookie } });
    assert.equal(listRes.json().links.length, 0);

    const archivedListRes = await app.inject({ method: 'GET', url: '/api/archive', headers: { cookie } });
    assert.equal(archivedListRes.json().links.length, 1);
    assert.equal(archivedListRes.json().links[0].id, link.id);

    const unarchiveRes = await app.inject({
      method: 'POST',
      url: `/api/links/${link.id}/unarchive`,
      headers: { cookie },
    });
    assert.equal(unarchiveRes.json().status, 'inbox');

    const listAfterRes = await app.inject({ method: 'GET', url: '/api/links', headers: { cookie } });
    assert.equal(listAfterRes.json().links.length, 1);

    await app.close();
  } finally {
    await cleanup();
  }
});

test('sections: create, 409 on duplicate, list, delete', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie } = await signupAndGetCookie(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sections',
      headers: { cookie },
      payload: { name: 'reading' },
    });
    assert.equal(createRes.statusCode, 201);
    const section = createRes.json();

    const conflictRes = await app.inject({
      method: 'POST',
      url: '/api/sections',
      headers: { cookie },
      payload: { name: 'reading' },
    });
    assert.equal(conflictRes.statusCode, 409);

    const listRes = await app.inject({ method: 'GET', url: '/api/sections', headers: { cookie } });
    assert.equal(listRes.json().sections.length, 1);

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/sections/${section.id}`,
      headers: { cookie },
    });
    assert.deepEqual(deleteRes.json(), { id: section.id, deleted: true });

    await app.close();
  } finally {
    await cleanup();
  }
});

test('logout-others signs out other sessions but keeps the current one', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie, email } = await signupAndGetCookie(app);

    const secondLoginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email, password: 'password123' },
    });
    const setCookie = secondLoginRes.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const otherCookie = raw?.split(';')[0];
    if (!otherCookie) throw new Error('login did not set a session cookie');

    const revokeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout-others',
      headers: { cookie },
    });
    assert.deepEqual(revokeRes.json(), { loggedOut: true });

    const meWithCurrent = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    assert.equal(meWithCurrent.json().email, email);

    const meWithOther = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: otherCookie } });
    assert.equal(meWithOther.json(), null);

    await app.close();
  } finally {
    await cleanup();
  }
});

test('login is rate-limited after repeated failures', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: { email: 'ratelimited@example.com', password: 'password123' },
    });

    let lastRes;
    for (let i = 0; i < 11; i += 1) {
      lastRes = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ratelimited@example.com', password: 'wrong-password' },
      });
    }
    assert.equal(lastRes!.statusCode, 429);
    assert.equal(lastRes!.json().code, 'RATE_LIMITED');

    await app.close();
  } finally {
    await cleanup();
  }
});

test('two accounts cannot see or delete each other\'s links via the API', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const { cookie: cookieA } = await signupAndGetCookie(app);
    const { cookie: cookieB } = await signupAndGetCookie(app);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/links',
      headers: { cookie: cookieA },
      payload: { url: 'https://example.com/private', title: 'A only' },
    });
    const link = createRes.json();

    const listAsB = await app.inject({ method: 'GET', url: '/api/links', headers: { cookie: cookieB } });
    assert.equal(listAsB.json().links.length, 0);

    const deleteAsB = await app.inject({
      method: 'DELETE',
      url: `/api/links/${link.id}`,
      headers: { cookie: cookieB },
    });
    assert.equal(deleteAsB.statusCode, 404);

    await app.close();
  } finally {
    await cleanup();
  }
});

test('GET /settings renders the settings page with categories and sections', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    let capturedInitialData: unknown;
    const capturingRenderer: SsrRenderer = {
      async renderPage(_url, initialData) {
        capturedInitialData = initialData;
        return '<!doctype html><html><body>stub</body></html>';
      },
    };
    const app = await buildApp(baseConfig, db, capturingRenderer);
    const { cookie, email } = await signupAndGetCookie(app);
    await app.inject({
      method: 'POST',
      url: '/api/sections',
      headers: { cookie },
      payload: { name: 'reading' },
    });

    const res = await app.inject({ method: 'GET', url: '/settings', headers: { cookie } });
    assert.equal(res.statusCode, 200);

    const data = capturedInitialData as {
      kind: string;
      user: { email: string };
      categories: string[];
      sections: { name: string }[];
    };
    assert.equal(data.kind, 'settings');
    assert.equal(data.user.email, email);
    assert.deepEqual(data.categories, ['reading']);
    assert.equal(data.sections.length, 1);
    assert.equal(data.sections[0]!.name, 'reading');

    await app.close();
  } finally {
    await cleanup();
  }
});

test('GET /settings falls back to the auth page when signed out', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    let capturedInitialData: unknown;
    const capturingRenderer: SsrRenderer = {
      async renderPage(_url, initialData) {
        capturedInitialData = initialData;
        return '<!doctype html><html><body>stub</body></html>';
      },
    };
    const app = await buildApp(baseConfig, db, capturingRenderer);
    const res = await app.inject({ method: 'GET', url: '/settings' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(capturedInitialData, { kind: 'auth' });
    await app.close();
  } finally {
    await cleanup();
  }
});

test('non-API GET falls through to the SSR renderer', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const app = await buildApp(baseConfig, db, stubSsrRenderer);
    const res = await app.inject({ method: 'GET', url: '/' });
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /stub/);
    await app.close();
  } finally {
    await cleanup();
  }
});
