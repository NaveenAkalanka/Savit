import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createTestUser } from './test-helpers.ts';
import { initSchema } from './db.ts';
import { createLink } from './links.ts';
import { listSections } from './sections.ts';

test('initSchema stays idempotent: re-running it never duplicates the category backfill', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    await createLink(db, userId, { url: 'https://example.com/a', category: 'reading' });

    // initSchema runs on every server startup, not just once — simulate that.
    await initSchema(db);
    await initSchema(db);
    await initSchema(db);

    const sections = await listSections(db, userId);
    assert.deepEqual(sections.map((s) => s.name), ['reading']);
  } finally {
    await cleanup();
  }
});
