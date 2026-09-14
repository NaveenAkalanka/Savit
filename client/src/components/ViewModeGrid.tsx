import { useState } from 'react';
import type { Link } from '@savit/shared';
import { DotsNine, SquaresFour } from '@phosphor-icons/react';
import type { GridDensity } from '../types.ts';
import { LinkCard } from './LinkCard.tsx';

export function ViewModeGrid({
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
  const [density, setDensity] = useState<GridDensity>('comfortable');
  const DensityIcon = density === 'comfortable' ? SquaresFour : DotsNine;

  if (links.length === 0) {
    return <div className="empty-state">No links saved yet</div>;
  }

  return (
    <div>
      <div className="grid-toolbar">
        <button
          type="button"
          className="icon-btn"
          onClick={() => setDensity(density === 'comfortable' ? 'compact' : 'comfortable')}
          title={`Density: ${density}`}
          aria-label={`Density: ${density}`}
        >
          <DensityIcon size={16} aria-hidden="true" />
        </button>
      </div>
      <div className={`link-grid${density === 'compact' ? ' compact' : ''}`}>
        {links.map((link) => (
          <LinkCard
            key={link.id}
            link={link}
            onEdit={onEdit}
            onDelete={onDelete}
            onRefreshScreenshot={onRefreshScreenshot}
            onArchive={onArchive}
          />
        ))}
      </div>
    </div>
  );
}
