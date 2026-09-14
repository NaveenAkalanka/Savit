import { useEffect, useState } from 'react';
import type { Link } from '@savit/shared';
import { ArrowCounterClockwise, Trash, X } from '@phosphor-icons/react';
import { formatAge } from '../relativeTime.ts';
import { DeleteConfirm } from './DeleteConfirm.tsx';

const DAY_MS = 24 * 60 * 60 * 1000;
const DELETE_ALL_PHRASE = 'DELETE ALL';

export function TrashDialog({
  open,
  onClose,
  links,
  retentionDays,
  loading,
  onRestore,
  onPurge,
  onPurgeAll,
}: {
  open: boolean;
  onClose: () => void;
  links: Link[];
  retentionDays: number;
  loading: boolean;
  onRestore: (id: number) => void;
  onPurge: (id: number) => void;
  onPurgeAll: () => void;
}) {
  const [deleteAllConfirm, setDeleteAllConfirm] = useState('');

  useEffect(() => {
    if (open) setDeleteAllConfirm('');
  }, [open]);

  if (!open) return null;

  const canPurgeAll = links.length > 0 && deleteAllConfirm.trim().toUpperCase() === DELETE_ALL_PHRASE;

  function handlePurgeAll() {
    setDeleteAllConfirm('');
    onPurgeAll();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} title="Close" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
        <h2>Trash</h2>
        <p className="trash-hint">
          Deleted items stay here for {retentionDays} days, then are purged automatically.
        </p>

        {loading && <div className="trash-empty">Loading…</div>}
        {!loading && links.length === 0 && <div className="trash-empty">Trash is empty</div>}

        <div className="trash-list">
          {links.map((link) => {
            const purgeAt = (link.deletedAt ?? Date.now()) + retentionDays * DAY_MS;
            return (
              <div key={link.id} className="trash-row">
                <div className="trash-row-info">
                  <span className="title">{link.title || link.url}</span>
                  <span className="expiry">Purges {formatAge(purgeAt)}</span>
                </div>
                <div className="trash-row-actions">
                  <button type="button" onClick={() => onRestore(link.id)}>
                    <ArrowCounterClockwise size={12} aria-hidden="true" />
                    Restore
                  </button>
                  <DeleteConfirm label="Delete Forever" onConfirm={() => onPurge(link.id)} />
                </div>
              </div>
            );
          })}
        </div>

        {links.length > 0 && (
          <div className="settings-section settings-section--danger">
            <h3 className="uc">Danger Zone</h3>
            <div className="settings-danger">
              <p>
                Permanently remove every item in Trash ({links.length}). This cannot be undone — there's no
                further recovery once purged.
              </p>
              <div className="settings-danger-row">
                <input
                  value={deleteAllConfirm}
                  onChange={(e) => setDeleteAllConfirm(e.target.value)}
                  placeholder={`Type "${DELETE_ALL_PHRASE}" to confirm`}
                />
                <button type="button" className="danger-btn" disabled={!canPurgeAll} onClick={handlePurgeAll}>
                  <Trash size={14} aria-hidden="true" />
                  Empty Trash
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
