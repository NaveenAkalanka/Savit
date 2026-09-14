import { useState } from 'react';
import {
  Archive,
  Funnel,
  Gear,
  MagnifyingGlass,
  SignOut,
  SortAscending,
  SortDescending,
  Trash,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import type { ViewMode } from '../types.ts';
import { SearchBar } from './SearchBar.tsx';
import { BookmarkletLink } from './BookmarkletLink.tsx';

export function SectionsPanel({
  open,
  onClose,
  categories,
  activeCategory,
  onSelectCategory,
  onOpenTrash,
  onOpenArchive,
  viewMode,
  sort,
  onToggleSort,
  query,
  onQueryChange,
  userEmail,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  categories: string[];
  activeCategory: string | null;
  onSelectCategory: (category: string | null) => void;
  onOpenTrash: () => void;
  onOpenArchive: () => void;
  viewMode: ViewMode;
  sort: 'newest' | 'oldest';
  onToggleSort: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  userEmail: string;
  onSignOut: () => void;
}) {
  const [hovering, setHovering] = useState(false);
  const visible = open || hovering;
  const showSort = viewMode === 'list' || viewMode === 'grid';
  const SortIcon = sort === 'newest' ? SortDescending : SortAscending;

  return (
    <>
      <div
        className={`sidebar-hover-zone${visible ? ' inactive' : ''}`}
        onMouseEnter={() => setHovering(true)}
      />
      {open && <div className="panel-backdrop" onClick={onClose} />}
      <aside
        className={`sections-panel${visible ? ' open' : ''}`}
        onMouseLeave={() => setHovering(false)}
      >
        <div className="sections-panel-scroll">
          {showSort && (
            <>
              <h2 className="uc">
                <SortIcon size={12} aria-hidden="true" /> Sort
              </h2>
              <button type="button" className="sidebar-sort" onClick={onToggleSort}>
                <SortIcon size={12} aria-hidden="true" />
                {sort === 'newest' ? 'Newest first' : 'Oldest first'}
              </button>
            </>
          )}

          <h2 className="uc">
            <MagnifyingGlass size={12} aria-hidden="true" /> Search
          </h2>
          <div className="sidebar-search">
            <SearchBar initialValue={query} onQueryChange={onQueryChange} />
          </div>

          <h2 className="uc section-heading">
            <span>
              <Funnel size={12} aria-hidden="true" /> Filter
            </span>
            {activeCategory !== null && (
              <button
                type="button"
                className="section-heading-clear"
                onClick={() => onSelectCategory(null)}
                title="Clear filter"
                aria-label="Clear filter"
              >
                <X size={11} aria-hidden="true" />
                Clear
              </button>
            )}
          </h2>
          <div className="category-pill-list">
            <button
              type="button"
              className={`category-pill${activeCategory === null ? ' active' : ''}`}
              onClick={() => onSelectCategory(null)}
            >
              All
            </button>
            {categories.map((category) => (
              <button
                key={category}
                type="button"
                className={`category-pill${activeCategory === category ? ' active' : ''}`}
                onClick={() => onSelectCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>

          <a className="sidebar-sort" href="/settings">
            <Gear size={12} aria-hidden="true" />
            Settings
          </a>

          <button type="button" className="sidebar-sort" onClick={onOpenArchive}>
            <Archive size={12} aria-hidden="true" />
            Archive
          </button>

          <button type="button" className="sidebar-sort" onClick={onOpenTrash}>
            <Trash size={12} aria-hidden="true" />
            Trash
          </button>

          <div className="sidebar-footer">
            <BookmarkletLink />
          </div>
        </div>

        <div className="sidebar-account-section">
          <span className="sidebar-account-email" title={userEmail}>
            <UserCircle size={14} aria-hidden="true" />
            {userEmail}
          </span>
          <button type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out">
            <SignOut size={13} aria-hidden="true" />
          </button>
        </div>
      </aside>
    </>
  );
}
