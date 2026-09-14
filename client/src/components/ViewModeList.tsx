import { useEffect, useRef, useState } from 'react';
import type { Link } from '@savit/shared';
import { ArrowSquareOut } from '@phosphor-icons/react';
import { RowMenu } from './RowMenu.tsx';
import { LinkPreview } from './LinkPreview.tsx';

const HOVER_DELAY_MS = 250;

export function ViewModeList({
  links,
  onEdit,
  onDelete,
  onRefreshScreenshot,
  onArchive,
}: {
  links: Link[];
  onEdit: (link: Link) => void;
  onDelete: (id: number) => void;
  onRefreshScreenshot: (id: number) => void | Promise<void>;
  onArchive: (id: number) => void;
}) {
  const [hover, setHover] = useState<{ link: Link; rect: DOMRect } | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function handleRowEnter(link: Link, e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setHover({ link, rect }), HOVER_DELAY_MS);
  }

  function handleRowLeave() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setHover(null);
  }

  if (links.length === 0) {
    return <div className="empty-state">No links saved yet</div>;
  }

  return (
    <div className="link-list">
      <div className="link-row link-row-head">
        <span>Name</span>
        <span>Link</span>
        <span>Description</span>
        <span>Category</span>
        <span />
      </div>
      {links.map((link) => (
        <div
          key={link.id}
          className="link-row"
          onMouseEnter={(e) => handleRowEnter(link, e)}
          onMouseLeave={handleRowLeave}
        >
          <span className="title">{link.title || link.url}</span>
          <span className="link-url">{link.origin.replace(/^https?:\/\//, '')}</span>
          <span className="description">{link.note || '—'}</span>
          <span className="category">{link.category || '—'}</span>
          <div className="link-actions">
            <a
              className="icon-btn"
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Open in new tab"
              aria-label="Open in new tab"
            >
              <ArrowSquareOut size={18} aria-hidden="true" />
            </a>
            <RowMenu
              url={link.url}
              onEdit={() => onEdit(link)}
              onDelete={() => onDelete(link.id)}
              onRefreshScreenshot={() => onRefreshScreenshot(link.id)}
              onArchive={() => onArchive(link.id)}
            />
          </div>
        </div>
      ))}
      {hover && <LinkPreview link={hover.link} rect={hover.rect} />}
    </div>
  );
}
