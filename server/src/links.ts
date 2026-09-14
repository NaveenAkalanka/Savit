import type { Client, InValue, Row } from '@libsql/client';
import type { CreateLinkInput, ImageSource, Link, ListLinksQuery, UpdateLinkInput } from '@savit/shared';
import { HttpError } from './errors.ts';

export const TRASH_RETENTION_DAYS = 30;
const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function normalizeCategory(category: string | undefined | null): string {
  return (category ?? '').trim().toLowerCase();
}

export function deriveOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    throw new HttpError(400, 'INVALID_INPUT', `Invalid URL: ${url}`);
  }
}

function rowToLink(row: Row): Link {
  return {
    id: Number(row.id),
    url: String(row.url),
    title: String(row.title),
    origin: String(row.origin),
    note: String(row.note),
    category: String(row.category),
    imageUrl: row.image_url === null ? null : String(row.image_url),
    imageSource: row.image_source as ImageSource,
    status: row.status as Link['status'],
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    deletedAt: row.deleted_at === null || row.deleted_at === undefined ? null : Number(row.deleted_at),
  };
}

function buildFtsQuery(q: string): string {
  const tokens = q.trim().split(/\s+/).filter(Boolean);
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

// Free hotlink screenshot service (thum.io) — no API key, renders on first
// request. Used only as a fallback cover when the caller has no real image
// (e.g. no og:image), so a grid card shows a page preview instead of a blank.
function buildScreenshotUrl(url: string, width = 600): string {
  return `https://image.thum.io/get/width/${width}/noanimate/${url}`;
}

export async function createLink(db: Client, userId: number, input: CreateLinkInput): Promise<Link> {
  if (!input.url || !input.url.trim()) {
    throw new HttpError(400, 'INVALID_INPUT', 'url is required');
  }
  const origin = deriveOrigin(input.url);
  const category = normalizeCategory(input.category);
  // imageSource intentionally stays 'none' for the generated screenshot fallback
  // (rather than 'auto') so a later no-image re-save's ON CONFLICT branch below
  // doesn't treat it as a "fresh" image and re-clobber a real cover added since.
  const imageSource: ImageSource = input.imageSource ?? (input.imageUrl ? 'auto' : 'none');
  const imageUrl = input.imageUrl ?? buildScreenshotUrl(input.url);
  const now = Date.now();

  const result = await db.execute({
    sql: `INSERT INTO links (user_id, url, title, origin, note, category, image_url, image_source, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'inbox', ?, ?)
      ON CONFLICT(user_id, url) DO UPDATE SET
        title = excluded.title,
        image_url = CASE WHEN excluded.image_source != 'none' THEN excluded.image_url ELSE links.image_url END,
        image_source = CASE WHEN excluded.image_source != 'none' THEN excluded.image_source ELSE links.image_source END,
        updated_at = excluded.updated_at,
        deleted_at = NULL
      RETURNING *`,
    args: [
      userId,
      input.url,
      input.title ?? '',
      origin,
      input.note ?? '',
      category,
      imageUrl,
      imageSource,
      now,
      now,
    ],
  });

  const row = result.rows[0];
  if (!row) throw new HttpError(500, 'DB_ERROR', 'Insert did not return a row');
  return rowToLink(row);
}

export async function listLinks(db: Client, userId: number, query: ListLinksQuery): Promise<Link[]> {
  const order = query.sort === 'oldest' ? 'ASC' : 'DESC';
  const category = query.category !== undefined ? normalizeCategory(query.category) : undefined;
  // Archived links are hidden from the normal dashboard view by default — same
  // idea as the trash. Pass status: 'archived' explicitly to see them instead.
  const status = query.status ?? 'inbox';
  const args: InValue[] = [userId];
  let sql: string;

  if (query.q && query.q.trim()) {
    sql = `SELECT links.* FROM links
      JOIN links_fts ON links_fts.rowid = links.id
      WHERE links.user_id = ? AND links_fts MATCH ? AND links.deleted_at IS NULL AND links.status = ?`;
    args.push(buildFtsQuery(query.q), status);
    if (category) {
      sql += ` AND links.category = ?`;
      args.push(category);
    }
    sql += ` ORDER BY links.created_at ${order}`;
  } else {
    sql = `SELECT * FROM links WHERE user_id = ? AND deleted_at IS NULL AND status = ?`;
    args.push(status);
    if (category) {
      sql += ` AND category = ?`;
      args.push(category);
    }
    sql += ` ORDER BY created_at ${order}`;
  }

  const result = await db.execute({ sql, args });
  return result.rows.map(rowToLink);
}

export async function listCategories(db: Client, userId: number): Promise<string[]> {
  const result = await db.execute({
    sql: `
    SELECT category AS name FROM links WHERE user_id = ? AND category != '' AND deleted_at IS NULL
    UNION
    SELECT name FROM sections WHERE user_id = ?
    ORDER BY name ASC
  `,
    args: [userId, userId],
  });
  return result.rows.map((row) => String(row.name));
}

export async function getLink(db: Client, userId: number, id: number): Promise<Link | null> {
  const result = await db.execute({
    sql: `SELECT * FROM links WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    args: [id, userId],
  });
  const row = result.rows[0];
  return row ? rowToLink(row) : null;
}

export async function updateLink(db: Client, userId: number, id: number, patch: UpdateLinkInput): Promise<Link> {
  const sets: string[] = [];
  const args: InValue[] = [];

  if ('title' in patch && patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title);
  }
  if ('note' in patch && patch.note !== undefined) {
    sets.push('note = ?');
    args.push(patch.note);
  }
  if ('category' in patch && patch.category !== undefined) {
    sets.push('category = ?');
    args.push(normalizeCategory(patch.category));
  }
  if ('imageUrl' in patch) {
    sets.push('image_url = ?');
    args.push(patch.imageUrl ?? null);
  }
  if ('imageSource' in patch && patch.imageSource !== undefined) {
    sets.push('image_source = ?');
    args.push(patch.imageSource);
  }

  sets.push('updated_at = ?');
  args.push(Date.now());
  args.push(id, userId);

  const result = await db.execute({
    sql: `UPDATE links SET ${sets.join(', ')} WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *`,
    args,
  });

  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
  return rowToLink(row);
}

// Forces a brand-new thum.io capture instead of replaying whatever was cached
// (or failed) the first time createLink ran — plain re-saving can't do this,
// since createLink's ON CONFLICT branch only overwrites image_url when the
// incoming imageSource isn't 'none', which it never is for the auto fallback.
// Alternating the requested width by 1px is invisible in the cropped cover
// thumbnail but changes the request enough to bypass thum.io's cache, without
// touching the target URL itself (so it can't break sites that already carry
// their own query string).
export async function refreshScreenshot(db: Client, userId: number, id: number): Promise<Link> {
  const link = await getLink(db, userId, id);
  if (!link) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
  const currentWidth = link.imageUrl?.match(/\/width\/(\d+)\//)?.[1];
  const nextWidth = currentWidth === '600' ? 601 : 600;
  const imageUrl = buildScreenshotUrl(link.url, nextWidth);

  const result = await db.execute({
    sql: `UPDATE links SET image_url = ?, image_source = 'none', updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *`,
    args: [imageUrl, Date.now(), id, userId],
  });
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
  return rowToLink(row);
}

export async function listArchived(db: Client, userId: number): Promise<Link[]> {
  const result = await db.execute({
    sql: `SELECT * FROM links WHERE user_id = ? AND status = 'archived' AND deleted_at IS NULL ORDER BY updated_at DESC`,
    args: [userId],
  });
  return result.rows.map(rowToLink);
}

export async function archiveLink(db: Client, userId: number, id: number): Promise<Link> {
  const result = await db.execute({
    sql: `UPDATE links SET status = 'archived', updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *`,
    args: [Date.now(), id, userId],
  });
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
  return rowToLink(row);
}

export async function unarchiveLink(db: Client, userId: number, id: number): Promise<Link> {
  const result = await db.execute({
    sql: `UPDATE links SET status = 'inbox', updated_at = ?
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL RETURNING *`,
    args: [Date.now(), id, userId],
  });
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
  return rowToLink(row);
}

export async function deleteLink(db: Client, userId: number, id: number): Promise<{ id: number; deleted: true }> {
  const result = await db.execute({
    sql: `UPDATE links SET deleted_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    args: [Date.now(), id, userId],
  });
  if (result.rowsAffected === 0) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found`);
  return { id, deleted: true };
}

export async function listTrash(db: Client, userId: number): Promise<Link[]> {
  const result = await db.execute({
    sql: `SELECT * FROM links WHERE user_id = ? AND deleted_at IS NOT NULL ORDER BY deleted_at DESC`,
    args: [userId],
  });
  return result.rows.map(rowToLink);
}

export async function restoreLink(db: Client, userId: number, id: number): Promise<Link> {
  const result = await db.execute({
    sql: `UPDATE links SET deleted_at = NULL WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL RETURNING *`,
    args: [id, userId],
  });
  const row = result.rows[0];
  if (!row) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found in trash`);
  return rowToLink(row);
}

export async function purgeLink(db: Client, userId: number, id: number): Promise<{ id: number; purged: true }> {
  const result = await db.execute({
    sql: `DELETE FROM links WHERE id = ? AND user_id = ? AND deleted_at IS NOT NULL`,
    args: [id, userId],
  });
  if (result.rowsAffected === 0) throw new HttpError(404, 'NOT_FOUND', `Link ${id} not found in trash`);
  return { id, purged: true };
}

export async function purgeExpiredTrash(db: Client): Promise<void> {
  await db.execute({
    sql: `DELETE FROM links WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
    args: [Date.now() - TRASH_RETENTION_MS],
  });
}
