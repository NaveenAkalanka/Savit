import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb, createTestUser } from './test-helpers.ts';
import { createSection, deleteSection, listSections, updateSection } from './sections.ts';
import { createLink, getLink } from './links.ts';
import { HttpError } from './errors.ts';

test('createSection normalizes (trim + lowercase) and rejects duplicates with 409', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    const section = await createSection(db, userId, '  Reading  ');
    assert.equal(section.name, 'reading');

    await assert.rejects(
      () => createSection(db, userId, 'reading'),
      (err: unknown) => err instanceof HttpError && err.status === 409 && err.code === 'CONFLICT',
    );
  } finally {
    await cleanup();
  }
});

test('deleteSection 404s on a missing id', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    await assert.rejects(
      () => deleteSection(db, userId, 999),
      (err: unknown) => err instanceof HttpError && err.status === 404,
    );
  } finally {
    await cleanup();
  }
});

test('listSections returns alphabetical order', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    await createSection(db, userId, 'zeta');
    await createSection(db, userId, 'alpha');
    const sections = await listSections(db, userId);
    assert.deepEqual(sections.map((s) => s.name), ['alpha', 'zeta']);
  } finally {
    await cleanup();
  }
});

test('deleteSection 409s when links still use it, until a reassignTo target is given', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    const section = await createSection(db, userId, 'reading');
    const link = await createLink(db, userId, { url: 'https://example.com/a', category: 'reading' });

    await assert.rejects(
      () => deleteSection(db, userId, section.id),
      (err: unknown) => err instanceof HttpError && err.status === 409 && err.code === 'CONFLICT',
    );

    await deleteSection(db, userId, section.id, 'archive');

    const moved = await getLink(db, userId, link.id);
    assert.equal(moved?.category, 'archive');
    assert.deepEqual(await listSections(db, userId), []);
  } finally {
    await cleanup();
  }
});

test('deleteSection with reassignTo="" moves links to Uncategorized', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    const section = await createSection(db, userId, 'reading');
    const link = await createLink(db, userId, { url: 'https://example.com/b', category: 'reading' });

    await deleteSection(db, userId, section.id, '');

    const moved = await getLink(db, userId, link.id);
    assert.equal(moved?.category, '');
  } finally {
    await cleanup();
  }
});

test('updateSection renames the section and cascades to every link using it', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userId = await createTestUser(db);
    const section = await createSection(db, userId, 'reading');
    const link = await createLink(db, userId, { url: 'https://example.com/c', category: 'reading' });

    const renamed = await updateSection(db, userId, section.id, 'books');
    assert.equal(renamed.name, 'books');

    const updated = await getLink(db, userId, link.id);
    assert.equal(updated?.category, 'books');
  } finally {
    await cleanup();
  }
});

test('two accounts can each have a section with the same name', async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const userA = await createTestUser(db);
    const userB = await createTestUser(db);

    await createSection(db, userA, 'reading');
    await createSection(db, userB, 'reading');

    assert.equal((await listSections(db, userA)).length, 1);
    assert.equal((await listSections(db, userB)).length, 1);
  } finally {
    await cleanup();
  }
});
