import { createClient, type Client } from '@libsql/client';

export interface DbConfig {
  tursoUrl: string;
  tursoAuthToken?: string;
}

export function createDb(config: DbConfig): Client {
  return createClient({ url: config.tursoUrl, authToken: config.tursoAuthToken });
}

async function tableHasColumn(db: Client, table: string, column: string): Promise<boolean> {
  const result = await db.execute(`PRAGMA table_info(${table})`);
  return result.rows.some((row) => (row as unknown as { name: string }).name === column);
}

async function tableExists(db: Client, table: string): Promise<boolean> {
  const result = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [table],
  });
  return result.rows.length > 0;
}

export async function initSchema(db: Client): Promise<void> {
  const linksExisted = await tableExists(db, 'links');
  const linksHadCategory = linksExisted && (await tableHasColumn(db, 'links', 'category'));
  const linksHadDeletedAt = linksExisted && (await tableHasColumn(db, 'links', 'deleted_at'));
  const linksHadUserId = linksExisted && (await tableHasColumn(db, 'links', 'user_id'));
  const sectionsExisted = await tableExists(db, 'sections');
  const sectionsHadUserId = sectionsExisted && (await tableHasColumn(db, 'sections', 'user_id'));

  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at    INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id         TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS links (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER,
        url          TEXT NOT NULL,
        title        TEXT NOT NULL DEFAULT '',
        origin       TEXT NOT NULL,
        note         TEXT NOT NULL DEFAULT '',
        category     TEXT NOT NULL DEFAULT '',
        image_url    TEXT,
        image_source TEXT CHECK(image_source IN ('auto','url','none')) DEFAULT 'none',
        status       TEXT CHECK(status IN ('inbox','archived')) NOT NULL DEFAULT 'inbox',
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL,
        deleted_at   INTEGER,
        UNIQUE(user_id, url)
      )`,
      `CREATE TABLE IF NOT EXISTS sections (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        name       TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE(user_id, name)
      )`,
    ],
    'write',
  );

  // Defensive schema evolution: a pre-multi-user `links`/`sections` table had a
  // globally-unique url/name and no owner at all. SQLite can't alter a UNIQUE
  // constraint in place, so recreate the table under the new (user_id, url) /
  // (user_id, name) constraint and copy every row across with user_id left NULL
  // — the first account ever to sign up (see auth.ts) claims those NULL rows,
  // so no pre-existing data is orphaned or lost.
  if (linksExisted && !linksHadUserId) {
    await db.batch(
      [
        `ALTER TABLE links RENAME TO links_pre_user`,
        `CREATE TABLE links (
          id           INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id      INTEGER,
          url          TEXT NOT NULL,
          title        TEXT NOT NULL DEFAULT '',
          origin       TEXT NOT NULL,
          note         TEXT NOT NULL DEFAULT '',
          category     TEXT NOT NULL DEFAULT '',
          image_url    TEXT,
          image_source TEXT CHECK(image_source IN ('auto','url','none')) DEFAULT 'none',
          status       TEXT CHECK(status IN ('inbox','archived')) NOT NULL DEFAULT 'inbox',
          created_at   INTEGER NOT NULL,
          updated_at   INTEGER NOT NULL,
          deleted_at   INTEGER,
          UNIQUE(user_id, url)
        )`,
        `INSERT INTO links (id, user_id, url, title, origin, note, category, image_url, image_source, status, created_at, updated_at, deleted_at)
          SELECT id, NULL, url, title, origin, note, category, image_url, image_source, status, created_at, updated_at, deleted_at FROM links_pre_user`,
        `DROP TABLE links_pre_user`,
      ],
      'write',
    );
  }

  if (sectionsExisted && !sectionsHadUserId) {
    await db.batch(
      [
        `ALTER TABLE sections RENAME TO sections_pre_user`,
        `CREATE TABLE sections (
          id         INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id    INTEGER,
          name       TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          UNIQUE(user_id, name)
        )`,
        `INSERT INTO sections (id, user_id, name, created_at)
          SELECT id, NULL, name, created_at FROM sections_pre_user`,
        `DROP TABLE sections_pre_user`,
      ],
      'write',
    );
  }

  // Defensive schema evolution: an older `links` table might predate the
  // `category` column. FTS5 can't gain a column in place, so drop + recreate + backfill.
  if (linksExisted && !linksHadCategory) {
    await db.execute(`ALTER TABLE links ADD COLUMN category TEXT NOT NULL DEFAULT ''`);
    await db.batch(
      [
        `DROP TABLE IF EXISTS links_fts`,
        `CREATE VIRTUAL TABLE links_fts USING fts5(
          title, url, note, category, content='links', content_rowid='id'
        )`,
        `INSERT INTO links_fts(rowid, title, url, note, category)
          SELECT id, title, url, note, category FROM links`,
      ],
      'write',
    );
  } else {
    await db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS links_fts USING fts5(
      title, url, note, category, content='links', content_rowid='id'
    )`);
  }

  // Defensive schema evolution: an older `links` table might predate the
  // `deleted_at` column used for soft-delete/trash.
  if (linksExisted && !linksHadDeletedAt) {
    await db.execute(`ALTER TABLE links ADD COLUMN deleted_at INTEGER`);
  }

  await db.batch(
    [
      `CREATE TRIGGER IF NOT EXISTS links_ai AFTER INSERT ON links BEGIN
        INSERT INTO links_fts(rowid, title, url, note, category)
          VALUES (new.id, new.title, new.url, new.note, new.category);
      END`,
      `CREATE TRIGGER IF NOT EXISTS links_ad AFTER DELETE ON links BEGIN
        INSERT INTO links_fts(links_fts, rowid, title, url, note, category)
          VALUES ('delete', old.id, old.title, old.url, old.note, old.category);
      END`,
      `CREATE TRIGGER IF NOT EXISTS links_au AFTER UPDATE ON links BEGIN
        INSERT INTO links_fts(links_fts, rowid, title, url, note, category)
          VALUES ('delete', old.id, old.title, old.url, old.note, old.category);
        INSERT INTO links_fts(rowid, title, url, note, category)
          VALUES (new.id, new.title, new.url, new.note, new.category);
      END`,
    ],
    'write',
  );

  // One-time backfill: promote any category already present on a link into a
  // real `sections` row (scoped to the same owner), so pre-existing categories
  // don't vanish from the picker. This runs on every startup, so it must be
  // genuinely idempotent — "INSERT OR IGNORE" alone isn't: SQLite's UNIQUE
  // constraint never treats two NULL user_id values as equal, so it silently
  // re-inserted a duplicate section on every restart before the first
  // signup ever claimed the NULL-owned rows. The explicit NOT EXISTS check
  // below uses `IS`, which (unlike `=`) does treat NULL as matching NULL.
  await db.execute({
    sql: `INSERT INTO sections (user_id, name, created_at)
      SELECT DISTINCT links.user_id, links.category, ?
      FROM links
      WHERE links.category != ''
        AND NOT EXISTS (
          SELECT 1 FROM sections
          WHERE sections.name = links.category
            AND sections.user_id IS links.user_id
        )`,
    args: [Date.now()],
  });
}
