import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient, type Client } from '@libsql/client';
import { initSchema } from './db.ts';
import { signup } from './auth.ts';

let userCounter = 0;

// Most link/section tests don't care about auth itself, just that a user
// exists to own the rows under test — a unique throwaway account per call.
export async function createTestUser(db: Client): Promise<number> {
  userCounter += 1;
  const { user } = await signup(db, `test-user-${userCounter}@example.com`, 'password123');
  return user.id;
}

export async function createTestDb(): Promise<{ db: Client; cleanup: () => Promise<void> }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'savit-test-'));
  const file = path.join(dir, 'test.db');
  const db = createClient({ url: `file:${file}` });
  await initSchema(db);
  return {
    db,
    cleanup: async () => {
      db.close();
      // Windows' native sqlite binding can hold the file handle open briefly
      // after close(); this is OS tmpdir litter either way, so best-effort only.
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
          return;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 150));
        }
      }
    },
  };
}
