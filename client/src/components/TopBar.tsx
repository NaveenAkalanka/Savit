import { Compass, List as ListIcon, Plus, Rows, SquaresFour } from '@phosphor-icons/react';
import type { ViewMode } from '../types.ts';

const VIEW_MODES: { mode: ViewMode; label: string; icon: typeof Rows }[] = [
  { mode: 'list', label: 'List', icon: Rows },
  { mode: 'grid', label: 'Grid', icon: SquaresFour },
  { mode: 'explore', label: 'Explore', icon: Compass },
];

export function TopBar({
  viewMode,
  onViewModeChange,
  linkCount,
  onSave,
  sidebarOpen,
  onToggleSidebar,
  showExplore = true,
}: {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  linkCount: number;
  onSave: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  showExplore?: boolean;
}) {
  const visibleModes = showExplore ? VIEW_MODES : VIEW_MODES.filter(({ mode }) => mode !== 'explore');

  return (
    <header className="top-bar">
      <div className="top-bar-left">
        <button
          type="button"
          className={`sidebar-toggle${sidebarOpen ? ' active' : ''}`}
          onClick={onToggleSidebar}
          title="Menu"
          aria-label="Toggle sidebar"
          aria-expanded={sidebarOpen}
        >
          <ListIcon size={18} aria-hidden="true" />
        </button>
        <div className="brand">
          <img className="brand-icon" src="/icon-mark.svg" alt="" aria-hidden="true" />
          <img className="logo" src="/logo.svg" alt="Savit" />
        </div>
      </div>
      <nav className="view-nav">
        {visibleModes.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            className={mode === viewMode ? 'active' : ''}
            onClick={() => onViewModeChange(mode)}
            title={label}
            aria-label={label}
          >
            <Icon size={16} aria-hidden="true" />
            <span className="nav-label">{label}</span>
          </button>
        ))}
      </nav>
      <div className="top-actions">
        <span className="count">{linkCount}</span>
        <button type="button" className="save-btn uc" onClick={onSave} title="Save" aria-label="Save">
          <Plus size={14} weight="bold" aria-hidden="true" />
          <span className="nav-label">Save</span>
        </button>
      </div>
    </header>
  );
}
