// Throwaway one-off ops script — not part of `npm test`. Manually confirms a
// fresh (or existing) Turso DB accepts the schema and FTS5 actually works.
// Run: node --env-file=../.env src/db.smoke.ts
import { createDb, initSchema } from './db.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const db = createDb(config);

await initSchema(db);
console.log('[db.smoke] initSchema OK');

const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type IN ('table','trigger') ORDER BY name`);
console.log(
  '[db.smoke] objects:',
  tables.rows.map((r) => r.name),
);

await initSchema(db); // idempotency check
console.log('[db.smoke] second initSchema call OK (idempotent)');

const testUrl = `https://savit-db-smoke.invalid/${Date.now()}`;
await db.execute({
  sql: `INSERT INTO links (url, title, origin, note, category, image_source, status, created_at, updated_at)
    VALUES (?, 'smoke test', 'https://savit-db-smoke.invalid', '', '', 'none', 'inbox', ?, ?)`,
  args: [testUrl, Date.now(), Date.now()],
});
const ftsResult = await db.execute({ sql: `SELECT * FROM links_fts WHERE links_fts MATCH ?`, args: ['smoke'] });
console.log('[db.smoke] FTS5 MATCH returned', ftsResult.rows.length, 'row(s)');
await db.execute({ sql: `DELETE FROM links WHERE url = ?`, args: [testUrl] });

console.log('[db.smoke] all checks passed');
db.close();
