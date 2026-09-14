// Replaces the setInterval in server/src/index.ts, which only exists for the
// long-lived Docker/Render process and has no equivalent in a serverless
// runtime (nothing stays alive between requests to run it on a timer here).
// GET /api/trash already purges inline on every read as a second safety net,
// so this is just about cleaning up trash nobody happens to be viewing.
import { loadConfig } from '../../server/src/config.ts';
import { createDb, initSchema } from '../../server/src/db.ts';
import { purgeExpiredTrash } from '../../server/src/links.ts';

export default async () => {
  const config = loadConfig([], process.env);
  const db = createDb(config);
  await initSchema(db);
  await purgeExpiredTrash(db);
};

export const config = {
  schedule: '0 */6 * * *',
};
