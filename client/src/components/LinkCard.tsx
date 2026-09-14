import { useState } from 'react';
import type { Link } from '@savit/shared';
import { formatAge } from '../relativeTime.ts';
import { RowMenu } from './RowMenu.tsx';
import { PlaceholderGlyph } from './PlaceholderGlyph.tsx';

export function LinkCard({
  link,
  onEdit,
  onDelete,
  onRefreshScreenshot,
  onArchive,
}: {
  link: Link;
  onEdit: (link: Link) => void;
  onDelete: (id: number) => void;
  onRefreshScreenshot: (id: number) => void | Promise<void>;
  onArchive: (id: number) => void;
}) {
  // Tracks the specific URL that failed, not just a bool — so refreshing the
  // screenshot (which changes link.imageUrl) doesn't leave the card stuck on
  // the placeholder from a previous, now-replaced image.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = link.imageUrl !== null && link.imageUrl !== failedUrl;

  function handleOpen() {
    window.open(link.url, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="link-card" onClick={handleOpen}>
      <div className="link-card-menu" onClick={(e) => e.stopPropagation()}>
        <RowMenu
          url={link.url}
          onEdit={() => onEdit(link)}
          onDelete={() => onDelete(link.id)}
          onRefreshScreenshot={() => onRefreshScreenshot(link.id)}
          onArchive={() => onArchive(link.id)}
        />
      </div>
      <div className="cover">
        {showImage ? (
          <img src={link.imageUrl!} alt="" onError={() => setFailedUrl(link.imageUrl)} />
        ) : (
          <PlaceholderGlyph className="placeholder-glyph" />
        )}
      </div>
      <div className="body">
        <div className="title">{link.title || link.url}</div>
        <div className="meta">
          <span>{link.category || '—'}</span>
          <span>{formatAge(link.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}
