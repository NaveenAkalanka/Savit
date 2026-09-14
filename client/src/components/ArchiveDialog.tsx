import type { Link } from '@savit/shared';
import { ArrowCounterClockwise, X } from '@phosphor-icons/react';
import { formatAge } from '../relativeTime.ts';

export function ArchiveDialog({
  open,
  onClose,
  links,
  loading,
  onUnarchive,
}: {
  open: boolean;
  onClose: () => void;
  links: Link[];
  loading: boolean;
  onUnarchive: (id: number) => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} title="Close" aria-label="Close">
          <X size={16} aria-hidden="true" />
        </button>
        <h2>Archive</h2>
        <p className="trash-hint">Archived links stay out of your main library until you bring them back.</p>

        {loading && <div className="trash-empty">Loading…</div>}
        {!loading && links.length === 0 && <div className="trash-empty">Nothing archived</div>}

        <div className="trash-list">
          {links.map((link) => (
            <div key={link.id} className="trash-row">
              <div className="trash-row-info">
                <span className="title">{link.title || link.url}</span>
                <span className="expiry">Archived {formatAge(link.updatedAt)}</span>
              </div>
              <div className="trash-row-actions">
                <button type="button" onClick={() => onUnarchive(link.id)}>
                  <ArrowCounterClockwise size={12} aria-hidden="true" />
                  Unarchive
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
