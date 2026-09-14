import type { Client, Row } from '@libsql/client';
import type { Section } from '@savit/shared';
import { HttpError } from './errors.ts';

function rowToSection(row: Row): Section {
  return { id: Number(row.id), name: String(row.name) };
}

function normalize(name: string): string {
  return name.trim().toLowerCase();
}

export async function listSections(db: Client, userId: number): Promise<Section[]> {
  const result = await db.execute({
    sql: `SELECT id, name FROM sections WHERE user_id = ? ORDER BY name ASC`,
    args: [userId],
  });
  return result.rows.map(rowToSection);
}

export async function createSection(db: Client, userId: number, name: string): Promise<Section> {
  const normalized = normalize(name);
  if (!normalized) {
    throw new HttpError(400, 'INVALID_INPUT', 'name is required');
  }

  const existing = await db.execute({
    sql: `SELECT id, name FROM sections WHERE user_id = ? AND name = ?`,
    args: [userId, normalized],
  });
  if (existing.rows[0]) {
    throw new HttpError(409, 'CONFLICT', `Section "${normalized}" already exists`);
  }

  const result = await db.execute({
    sql: `INSERT INTO sections (user_id, name, created_at) VALUES (?, ?, ?) RETURNING id, name`,
    args: [userId, normalized, Date.now()],
  });
  const row = result.rows[0];
  if (!row) throw new HttpError(500, 'DB_ERROR', 'Insert did not return a row');
  return rowToSection(row);
}

// Renaming a section also renames the matching category on every link that
// carries it — categories are just a free-text field on links, so a section
// rename would otherwise silently orphan the old name on existing links while
// the picker only ever shows the new one.
export async function updateSection(db: Client, userId: number, id: number, name: string): Promise<Section> {
  const normalized = normalize(name);
  if (!normalized) {
    throw new HttpError(400, 'INVALID_INPUT', 'name is required');
  }

  const current = await db.execute({
    sql: `SELECT id, name FROM sections WHERE id = ? AND user_id = ?`,
    args: [id, userId],
  });
  const currentRow = current.rows[0];
  if (!currentRow) throw new HttpError(404, 'NOT_FOUND', `Section ${id} not found`);
  const oldName = String(currentRow.name);

  if (normalized !== oldName) {
    const conflict = await db.execute({
      sql: `SELECT id FROM sections WHERE user_id = ? AND name = ? AND id != ?`,
      args: [userId, normalized, id],
    });
    if (conflict.rows[0]) {
      throw new HttpError(409, 'CONFLICT', `Section "${normalized}" already exists`);
    }
  }

  await db.batch(
    [
      { sql: `UPDATE sections SET name = ? WHERE id = ? AND user_id = ?`, args: [normalized, id, userId] },
      { sql: `UPDATE links SET category = ? WHERE user_id = ? AND category = ?`, args: [normalized, userId, oldName] },
    ],
    'write',
  );

  return { id, name: normalized };
}

// A section with links still assigned to it can't be deleted outright — the
// caller must pass `reassignTo` (an existing category name, or '' for
// Uncategorized) so those links land somewhere explicit instead of silently
// losing their category.
export async function deleteSection(
  db: Client,
  userId: number,
  id: number,
  reassignTo?: string,
): Promise<{ id: number; deleted: true }> {
  const current = await db.execute({
    sql: `SELECT id, name FROM sections WHERE id = ? AND user_id = ?`,
    args: [id, userId],
  });
  const currentRow = current.rows[0];
  if (!currentRow) throw new HttpError(404, 'NOT_FOUND', `Section ${id} not found`);
  const name = String(currentRow.name);

  const countResult = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM links WHERE user_id = ? AND category = ? AND deleted_at IS NULL`,
    args: [userId, name],
  });
  const linkedCount = Number(countResult.rows[0]?.n ?? 0);

  if (linkedCount > 0 && reassignTo === undefined) {
    throw new HttpError(
      409,
      'CONFLICT',
      `Section "${name}" has ${linkedCount} linked record(s); reassign them to another category first`,
    );
  }

  if (linkedCount > 0) {
    const normalizedTarget = normalize(reassignTo ?? '');
    await db.batch(
      [
        {
          sql: `UPDATE links SET category = ? WHERE user_id = ? AND category = ?`,
          args: [normalizedTarget, userId, name],
        },
        { sql: `DELETE FROM sections WHERE id = ? AND user_id = ?`, args: [id, userId] },
      ],
      'write',
    );
  } else {
    await db.execute({ sql: `DELETE FROM sections WHERE id = ? AND user_id = ?`, args: [id, userId] });
  }

  return { id, deleted: true };
}
