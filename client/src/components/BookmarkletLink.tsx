import { useEffect, useState } from 'react';
import { BookmarkSimple } from '@phosphor-icons/react';
import { buildBookmarkletHref } from '../bookmarklet.ts';

export function BookmarkletLink() {
  const [origin, setOrigin] = useState('');

  useEffect(() => setOrigin(window.location.origin), []);

  if (!origin) return null;

  return (
    <a
      className="bookmarklet-link"
      href={buildBookmarkletHref(origin)}
      onClick={(e) => e.preventDefault()}
      title="Drag to your bookmarks bar to save from any page"
    >
      <BookmarkSimple size={14} weight="regular" aria-hidden="true" />
      Drag &amp; drop bookmark here
    </a>
  );
}
