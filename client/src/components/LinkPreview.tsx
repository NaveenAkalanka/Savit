import { useState } from 'react';
import type { Link } from '@savit/shared';

const MAX_WIDTH = 440;
const VIEWPORT_MARGIN = 16; // keeps the preview clear of the screen edge on any viewport size

export function LinkPreview({ link, rect }: { link: Link; rect: DOMRect }) {
  const [failed, setFailed] = useState(false);

  if (!link.imageUrl || failed) return null;

  // width is capped to the actual viewport (not just the desktop-sized default),
  // so the preview never spills past the edge of a narrow screen
  const width = Math.min(MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2);
  const height = (width * 9) / 16 + 2; // 16:9 image + 1px border top/bottom

  let left = Math.min(rect.left, window.innerWidth - width - VIEWPORT_MARGIN);
  left = Math.max(left, VIEWPORT_MARGIN);

  const showAbove = rect.bottom + height + 8 > window.innerHeight;
  let top = showAbove ? rect.top - height - 8 : rect.bottom + 8;
  top = Math.min(top, window.innerHeight - height - VIEWPORT_MARGIN);
  top = Math.max(top, VIEWPORT_MARGIN);

  return (
    <div className="link-preview" style={{ left, top, width }}>
      <img src={link.imageUrl} alt="" onError={() => setFailed(true)} />
    </div>
  );
}
