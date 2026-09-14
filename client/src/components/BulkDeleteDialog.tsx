import { useEffect, useState } from 'react';
import type { Link } from '@savit/shared';
import { ArrowsLeftRight, Trash, X } from '@phosphor-icons/react';
import { api } from '../api.ts';
import { DeleteConfirm } from './DeleteConfirm.tsx';

const DELETE_ALL_PHRASE = 'DELETE ALL';

export function BulkDeleteDialog({
  open,
  onClose,
  onLinksChanged,
  categories,
}: {
  open: boolean;
  onClose: () => void;
  onLinksChanged: () => void;
  categories: string[];
}) {
  const [links, setLinks] = useState<Link[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('');
  const [moveTarget, setMoveTarget] = useState('');
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setDeleteAllConfirm('');
    setMoveTarget('');
    setLoading(true);
    api
      .list({})
      .then((res) => setLinks(res.links))
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedIds((prev) => (prev.size === links.length ? new Set() : new Set(links.map((l) => l.id))));
  }

  async function handleMoveSelected() {
    const ids = [...selectedIds];
    setMoving(true);
    try {
      await Promise.all(ids.map((id) => api.update(id, { category: moveTarget })));
      setLinks((prev) => prev.map((l) => (selectedIds.has(l.id) ? { ...l, category: moveTarget } : l)));
      setSelectedIds(new Set());
      onLinksChanged();
    } finally {
      setMoving(false);
    }
  }

  async function handleDeleteSelected() {
    const ids = [...selectedIds];
    setLinks((prev) => prev.filter((l) => !selectedIds.has(l.id)));
    setSelectedIds(new Set());
    await Promise.all(ids.map((id) => api.remove(id)));
    onLinksChanged();
  }

  async function handleDeleteAll() {
    const ids = links.map((l) => l.id);
    setLinks([]);
    setSelectedIds(new Set());
    setDeleteAllConfirm('');
    await Promise.all(ids.map((id) => api.remove(id)));
    onLinksChanged();
  }

  const canDeleteAll = links.length > 0 && deleteAllConfirm.trim().toUpperCase() === DELETE_ALL_PHRASE;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} title="Close" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
        <h2>Bulk Actions</h2>

        <div className="settings-section">
          <div className="settings-links-toolbar">
            <label>
              <input
                type="checkbox"
                checked={links.length > 0 && selectedIds.size === links.length}
                onChange={toggleSelectAll}
              />{' '}
              {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${links.length} total`}
            </label>
            {selectedIds.size > 0 && (
              <div className="settings-credential-actions">
                <select value={moveTarget} onChange={(e) => setMoveTarget(e.target.value)}>
                  <option value="">Uncategorized</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                <button type="button" className="icon-btn" onClick={handleMoveSelected} disabled={moving}>
                  <ArrowsLeftRight size={12} aria-hidden="true" />
                  {moving ? 'Moving…' : `Move Selected (${selectedIds.size})`}
                </button>
                <DeleteConfirm label={`Delete Selected (${selectedIds.size})`} onConfirm={handleDeleteSelected} />
              </div>
            )}
          </div>
          <div className="settings-links-list">
            {loading && <div className="trash-empty">Loading…</div>}
            {!loading && links.length === 0 && <div className="trash-empty">No links saved yet</div>}
            {links.map((link) => (
              <label key={link.id} className="settings-link-row">
                <input
                  type="checkbox"
                  checked={selectedIds.has(link.id)}
                  onChange={() => toggleSelect(link.id)}
                />
                <span className="title">{link.title || link.url}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="settings-section">
          <h3 className="uc">Danger Zone</h3>
          <div className="settings-danger">
            <p>
              Permanently remove every saved link ({links.length}). Deleted items land in Trash first and can
              still be restored during the retention window.
            </p>
            <div className="settings-danger-row">
              <input
                value={deleteAllConfirm}
                onChange={(e) => setDeleteAllConfirm(e.target.value)}
                placeholder={`Type "${DELETE_ALL_PHRASE}" to confirm`}
              />
              <button type="button" className="danger-btn" disabled={!canDeleteAll} onClick={handleDeleteAll}>
                <Trash size={14} aria-hidden="true" />
                Delete All
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
