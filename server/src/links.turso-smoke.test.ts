// Opt-in: only runs when TURSO_DATABASE_URL is set. Confirms FTS5 and the
// upsert path behave the same way on hosted Turso as on local libSQL — the one
// assumption in the whole design worth verifying empirically since it gates search.
// Run manually: node --env-file=../.env --test src/links.turso-smoke.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@libsql/client';
import { initSchema } from './db.ts';
import { createLink, deleteLink, listLinks } from './links.ts';
import { signup } from './auth.ts';

const enabled = Boolean(process.env.TURSO_DATABASE_URL);
const testUrlPrefix = 'https://savit-test-smoke.invalid/';
const testEmail = `savit-test-smoke-${Date.now()}@invalid`;

test('hosted Turso: FTS5 + upsert smoke test', { skip: !enabled }, async () => {
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  try {
    await initSchema(db);
    const { user } = await signup(db, testEmail, 'smoke-test-password');

    const url = `${testUrlPrefix}${Date.now()}`;
    const link = await createLink(db, user.id, { url, title: 'Savit smoke test', category: 'smoke' });
    assert.equal(link.origin, 'https://savit-test-smoke.invalid');

    const found = await listLinks(db, user.id, { q: 'smoke' });
    assert.ok(found.some((l) => l.url === url));

    await deleteLink(db, user.id, link.id);
  } finally {
    await db.execute({
      sql: `DELETE FROM links WHERE url LIKE ?`,
      args: [`${testUrlPrefix}%`],
    });
    await db.execute({ sql: `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ?)`, args: [testEmail] });
    await db.execute({ sql: `DELETE FROM users WHERE email = ?`, args: [testEmail] });
    db.close();
  }
});
