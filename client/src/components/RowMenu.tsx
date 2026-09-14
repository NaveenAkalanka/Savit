import { useEffect, useRef, useState } from 'react';
import { Archive, ArrowClockwise, Check, CopySimple, DotsThreeVertical, PencilSimple } from '@phosphor-icons/react';
import { DeleteConfirm } from './DeleteConfirm.tsx';

export function RowMenu({
  url,
  onEdit,
  onDelete,
  onRefreshScreenshot,
  onArchive,
}: {
  url: string;
  onEdit: () => void;
  onDelete: () => void;
  onRefreshScreenshot: () => void | Promise<void>;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setOpen(false), 600);
    } catch {
      setOpen(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await onRefreshScreenshot();
    } finally {
      setRefreshing(false);
      setOpen(false);
    }
  }

  return (
    <div className="row-menu" ref={ref}>
      <button
        type="button"
        className="icon-btn"
        onClick={() => setOpen((v) => !v)}
        title="More actions"
        aria-label="More actions"
        aria-expanded={open}
      >
        <DotsThreeVertical size={20} weight="bold" aria-hidden="true" />
      </button>
      {open && (
        <div className="row-menu-dropdown">
          <button type="button" className="row-menu-item" onClick={handleCopy}>
            {copied ? <Check size={14} aria-hidden="true" /> : <CopySimple size={14} aria-hidden="true" />}
            {copied ? 'Copied' : 'Copy link'}
          </button>
          <button
            type="button"
            className="row-menu-item"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          >
            <PencilSimple size={14} aria-hidden="true" />
            Edit
          </button>
          <button type="button" className="row-menu-item" onClick={handleRefresh} disabled={refreshing}>
            <ArrowClockwise size={14} aria-hidden="true" />
            {refreshing ? 'Refreshing…' : 'Refresh screenshot'}
          </button>
          <button
            type="button"
            className="row-menu-item"
            onClick={() => {
              setOpen(false);
              onArchive();
            }}
          >
            <Archive size={14} aria-hidden="true" />
            Archive
          </button>
          <DeleteConfirm onConfirm={onDelete} />
        </div>
      )}
    </div>
  );
}
