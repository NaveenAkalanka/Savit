import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createTestUser } from './test-helpers.ts';
import { createLink, deleteLink, deriveOrigin, getLink, listCategories, listLinks, updateLink } from './links.ts';
import { createSection } from './sections.ts';

test('deriveOrigin throws INVALID_INPUT on a malformed url', () => {
  assert.throws(() => deriveOrigin('not a url'));
});

test('createLink upserts on re-save without duplicating, preserving note/category', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    const first = await createLink(db, userId, { url: 'https://example.com/a', title: 'A', category: 'Reading' });
    assert.equal(first.category, 'reading');
    assert.equal(first.origin, 'https://example.com');

    await updateLink(db, userId, first.id, { note: 'my note' });

    const second = await createLink(db, userId, { url: 'https://example.com/a', title: 'A updated', category: 'other' });
    assert.equal(second.id, first.id);
    assert.equal(second.title, 'A updated');
    assert.equal(second.category, 'reading', 'category must survive a re-save');
    assert.equal(second.note, 'my note', 'note must survive a re-save');

    const all = await listLinks(db, userId, {});
    assert.equal(all.length, 1);
  } finally {
    await cleanup();
  }
});

test('image refresh only happens when the new save actually supplies an image', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    const first = await createLink(db, userId, {
      url: 'https://example.com/b',
      imageUrl: 'https://example.com/cover.png',
      imageSource: 'auto',
    });
    assert.equal(first.imageUrl, 'https://example.com/cover.png');

    const resaved = await createLink(db, userId, { url: 'https://example.com/b' });
    assert.equal(resaved.imageUrl, 'https://example.com/cover.png', 'image must survive a no-image re-save');
  } finally {
    await cleanup();
  }
});

test('listLinks full-text search matches title/url/note/category', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    await createLink(db, userId, { url: 'https://example.com/foo-bar', title: 'Hello World', category: 'tech' });
    await createLink(db, userId, { url: 'https://example.com/baz', title: 'Something else', category: 'life' });

    const results = await listLinks(db, userId, { q: 'hello' });
    assert.equal(results.length, 1);
    assert.match(results[0]!.title, /Hello/);
  } finally {
    await cleanup();
  }
});

test('search input with hyphens/quotes/boolean keywords does not throw FTS syntax errors', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    await createLink(db, userId, { url: 'https://example.com/x', title: 'Test' });
    await assert.doesNotReject(() => listLinks(db, userId, { q: 'foo-bar "baz OR NOT AND' }));
  } finally {
    await cleanup();
  }
});

test('listCategories unions defined sections and in-use link categories', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    await createLink(db, userId, { url: 'https://example.com/a', category: 'alpha' });
    await createSection(db, userId, 'beta');

    const categories = await listCategories(db, userId);
    assert.deepEqual([...categories].sort(), ['alpha', 'beta']);
  } finally {
    await cleanup();
  }
});

test('getLink/updateLink/deleteLink 404 on a missing id', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    assert.equal(await getLink(db, userId, 999), null);
    await assert.rejects(() => updateLink(db, userId, 999, { title: 'x' }));
    await assert.rejects(() => deleteLink(db, userId, 999));
  } finally {
    await cleanup();
  }
});

test('one account can never see, edit, or delete another account\'s links', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await createTestUser(db);
    const userB = await createTestUser(db);

    const link = await createLink(db, userA, { url: 'https://example.com/private', title: 'Mine' });

    assert.equal(await getLink(db, userB, link.id), null, 'other user cannot read it by id');
    assert.deepEqual(await listLinks(db, userB, {}), [], "other user's list is empty");
    await assert.rejects(() => updateLink(db, userB, link.id, { title: 'hijacked' }));
    await assert.rejects(() => deleteLink(db, userB, link.id));

    // and it's untouched from the real owner's side
    const stillThere = await getLink(db, userA, link.id);
    assert.equal(stillThere?.title, 'Mine');
  } finally {
    await cleanup();
  }
});

test('two accounts can each save the exact same URL independently', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await createTestUser(db);
    const userB = await createTestUser(db);

    const a = await createLink(db, userA, { url: 'https://example.com/shared', title: 'A copy' });
    const b = await createLink(db, userB, { url: 'https://example.com/shared', title: 'B copy' });

    assert.notEqual(a.id, b.id);
    assert.equal(a.title, 'A copy');
    assert.equal(b.title, 'B copy');
  } finally {
    await cleanup();
  }
});
