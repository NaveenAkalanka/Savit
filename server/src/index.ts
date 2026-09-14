import { loadConfig } from './config.ts';
import { createDb, initSchema } from './db.ts';
import { buildApp } from './app.ts';
import { purgeExpiredTrash } from './links.ts';

const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

const config = loadConfig();
const db = createDb(config);
await initSchema(db);
await purgeExpiredTrash(db);
setInterval(() => void purgeExpiredTrash(db), PURGE_INTERVAL_MS).unref();
const app = await buildApp(config, db);

await app.listen({ port: config.port, host: config.host });
