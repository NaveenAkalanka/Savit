import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import type { Client, Row } from '@libsql/client';
import type { User } from '@savit/shared';
import { HttpError } from './errors.ts';

export const SESSION_COOKIE = 'savit_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SCRYPT_KEYLEN = 64;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Session tokens are stored hashed — a read-only leak of the sessions table
// alone isn't enough to impersonate a logged-in user.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function createSession(db: Client, userId: number): Promise<string> {
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    args: [hashToken(token), userId, now, now + SESSION_TTL_MS],
  });
  return token;
}

function rowToUser(row: Row): User {
  return { id: Number(row.id), email: String(row.email), createdAt: Number(row.created_at) };
}

export async function signup(db: Client, email: string, password: string): Promise<{ user: User; token: string }> {
  const normalized = normalizeEmail(email);
  if (!normalized || !normalized.includes('@')) {
    throw new HttpError(400, 'INVALID_INPUT', 'A valid email is required');
  }
  if (!password || password.length < 8) {
    throw new HttpError(400, 'INVALID_INPUT', 'Password must be at least 8 characters');
  }

  const existing = await db.execute({ sql: `SELECT id FROM users WHERE email = ?`, args: [normalized] });
  if (existing.rows[0]) {
    throw new HttpError(409, 'CONFLICT', 'An account with this email already exists');
  }

  const countRow = (await db.execute(`SELECT COUNT(*) AS n FROM users`)).rows[0];
  const isFirstAccount = Number(countRow?.n ?? 0) === 0;

  const now = Date.now();
  const result = await db.execute({
    sql: `INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?) RETURNING id, email, created_at`,
    args: [normalized, hashPassword(password), now],
  });
  const row = result.rows[0];
  if (!row) throw new HttpError(500, 'DB_ERROR', 'Insert did not return a row');
  const user = rowToUser(row);

  // The very first account ever created inherits any data saved before
  // multi-user accounts existed (see db.ts's links/sections migration).
  if (isFirstAccount) {
    await db.batch(
      [
        { sql: `UPDATE links SET user_id = ? WHERE user_id IS NULL`, args: [user.id] },
        { sql: `UPDATE sections SET user_id = ? WHERE user_id IS NULL`, args: [user.id] },
      ],
      'write',
    );
  }

  const token = await createSession(db, user.id);
  return { user, token };
}

export async function login(db: Client, email: string, password: string): Promise<{ user: User; token: string }> {
  const normalized = normalizeEmail(email);
  const result = await db.execute({
    sql: `SELECT id, email, created_at, password_hash FROM users WHERE email = ?`,
    args: [normalized],
  });
  const row = result.rows[0];
  if (!row || !verifyPassword(password, String(row.password_hash))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Invalid email or password');
  }
  const user = rowToUser(row);
  const token = await createSession(db, user.id);
  return { user, token };
}

export async function logout(db: Client, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.execute({ sql: `DELETE FROM sessions WHERE id = ?`, args: [hashToken(token)] });
}

// Signs out every other session for this account (other browsers/devices)
// while leaving the session making this request intact — a lighter-weight
// alternative to changing the password, which nukes every session including
// the current one.
export async function logoutOtherSessions(db: Client, userId: number, currentToken: string | undefined): Promise<void> {
  if (currentToken) {
    await db.execute({
      sql: `DELETE FROM sessions WHERE user_id = ? AND id != ?`,
      args: [userId, hashToken(currentToken)],
    });
  } else {
    await db.execute({ sql: `DELETE FROM sessions WHERE user_id = ?`, args: [userId] });
  }
}

// Changing the password re-verifies the current one (no separate OTP step —
// this is a single-user-per-account LAN app, not a service where the account
// holder and the person at the keyboard might differ) and invalidates every
// session, this one included, so the new password takes effect immediately
// everywhere it's logged in.
export async function changePassword(
  db: Client,
  userId: number,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const result = await db.execute({ sql: `SELECT password_hash FROM users WHERE id = ?`, args: [userId] });
  const row = result.rows[0];
  if (!row || !verifyPassword(currentPassword, String(row.password_hash))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Current password is incorrect');
  }
  if (!newPassword || newPassword.length < 8) {
    throw new HttpError(400, 'INVALID_INPUT', 'New password must be at least 8 characters');
  }

  await db.batch(
    [
      { sql: `UPDATE users SET password_hash = ? WHERE id = ?`, args: [hashPassword(newPassword), userId] },
      { sql: `DELETE FROM sessions WHERE user_id = ?`, args: [userId] },
    ],
    'write',
  );
}

export async function changeEmail(
  db: Client,
  userId: number,
  currentPassword: string,
  newEmail: string,
): Promise<User> {
  const normalized = normalizeEmail(newEmail);
  if (!normalized || !normalized.includes('@')) {
    throw new HttpError(400, 'INVALID_INPUT', 'A valid email is required');
  }

  const result = await db.execute({ sql: `SELECT password_hash FROM users WHERE id = ?`, args: [userId] });
  const row = result.rows[0];
  if (!row || !verifyPassword(currentPassword, String(row.password_hash))) {
    throw new HttpError(401, 'UNAUTHORIZED', 'Current password is incorrect');
  }

  const conflict = await db.execute({
    sql: `SELECT id FROM users WHERE email = ? AND id != ?`,
    args: [normalized, userId],
  });
  if (conflict.rows[0]) {
    throw new HttpError(409, 'CONFLICT', 'An account with this email already exists');
  }

  const updated = await db.execute({
    sql: `UPDATE users SET email = ? WHERE id = ? RETURNING id, email, created_at`,
    args: [normalized, userId],
  });
  const updatedRow = updated.rows[0];
  if (!updatedRow) throw new HttpError(500, 'DB_ERROR', 'Update did not return a row');
  return rowToUser(updatedRow);
}

export async function getUserForToken(db: Client, token: string | undefined): Promise<User | null> {
  if (!token) return null;
  const result = await db.execute({
    sql: `SELECT users.id AS id, users.email AS email, users.created_at AS created_at, sessions.expires_at AS expires_at
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.id = ?`,
    args: [hashToken(token)],
  });
  const row = result.rows[0];
  if (!row || Number(row.expires_at) < Date.now()) return null;
  return rowToUser(row);
}
