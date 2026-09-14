import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { Link } from '@savit/shared';
import type { DashboardInitialData } from '../types.ts';
import { api } from '../api.ts';
import { parseUrlState, buildUrlSearch } from '../urlState.ts';
import { TopBar } from './TopBar.tsx';
import { SectionsPanel } from './SectionsPanel.tsx';
import { TrashDialog } from './TrashDialog.tsx';
import { ArchiveDialog } from './ArchiveDialog.tsx';
import { ViewModeList } from './ViewModeList.tsx';
import { ViewModeGrid } from './ViewModeGrid.tsx';
import { SaveDialog } from './SaveDialog.tsx';

// Dynamically imported (not a static import) so the three.js/@react-three/fiber
// module graph — which touches WebGL/canvas globals that don't exist under
// Node — is never evaluated during SSR. React's synchronous renderToString
// resolves a suspended child by rendering the fallback, so this is SSR-safe
// without any extra client-only guard.
const ViewModeExplore = lazy(() =>
  import('./ViewModeExplore.tsx').then((m) => ({ default: m.ViewModeExplore })),
);

export function Dashboard({ url, initialData }: { url: string; initialData: DashboardInitialData }) {
  const initial = parseUrlState(url);

  const [links, setLinks] = useState<Link[]>(initialData.links);
  const [categories, setCategories] = useState<string[]>(initialData.categories);

  const [viewMode, setViewMode] = useState(initial.viewMode);
  const [sort, setSort] = useState(initial.sort);
  // A category deleted from Settings (a separate page/reload) could still be
  // sitting in the URL from before — drop it rather than filtering to a
  // category the fresh SSR categories list no longer has.
  const [activeCategory, setActiveCategory] = useState<string | null>(() =>
    initial.category && initialData.categories.includes(initial.category) ? initial.category : null,
  );
  const [query, setQuery] = useState(initial.query);
  const [sidebarOpen, setSidebarOpen] = useState(initial.query.length > 0);
  const [editingLink, setEditingLink] = useState<Link | null>(null);
  const [creating, setCreating] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const [trashLinks, setTrashLinks] = useState<Link[]>([]);
  const [trashRetentionDays, setTrashRetentionDays] = useState(30);
  const [trashLoading, setTrashLoading] = useState(false);

  const [archivedLinks, setArchivedLinks] = useState<Link[]>([]);
  const [archiveLoading, setArchiveLoading] = useState(false);

  // Explore is a WebGL drag-to-rotate 3D view — not usable on small/touch
  // screens (no room, no reliable drag gesture), so it's hidden below the
  // same phone breakpoint the rest of the layout switches at.
  const [smallScreen, setSmallScreen] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia('(max-width: 640px)');
    function update() {
      setSmallScreen(mql.matches);
      if (mql.matches) setViewMode((v) => (v === 'explore' ? 'list' : v));
    }
    update();
    mql.addEventListener('change', update);
    return () => mql.removeEventListener('change', update);
  }, []);

  // "/" focuses search (opening the sidebar it lives in first, if needed) and
  // Escape backs out of whatever's currently open — one modal/dialog at a
  // time, most-recently-opened first, then the sidebar itself.
  useEffect(() => {
    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === '/' && !isTypingTarget(e.target)) {
        e.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => {
          document.getElementById('global-search-input')?.focus();
        });
        return;
      }

      if (e.key === 'Escape') {
        if (editingLink || creating) {
          setEditingLink(null);
          setCreating(false);
        } else if (archiveOpen) {
          setArchiveOpen(false);
        } else if (trashOpen) {
          setTrashOpen(false);
        } else if (sidebarOpen) {
          setSidebarOpen(false);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingLink, creating, archiveOpen, trashOpen, sidebarOpen]);

  const isFirstRender = useRef(true);

  useEffect(() => {
    const search = buildUrlSearch({ viewMode, sort, category: activeCategory, query });
    const next = `${window.location.pathname}${search}`;
    if (next !== window.location.pathname + window.location.search) {
      window.history.replaceState(null, '', next);
    }
  }, [viewMode, sort, activeCategory, query]);

  async function refresh() {
    const [linksRes, categoriesRes] = await Promise.all([
      api.list({ q: query || undefined, category: activeCategory ?? undefined, sort }),
      api.categories(),
    ]);
    setLinks(linksRes.links);
    setCategories(categoriesRes.categories);
  }

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, activeCategory, sort]);

  async function handleDelete(id: number) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    try {
      await api.remove(id);
    } finally {
      refresh();
    }
  }

  async function handleRefreshScreenshot(id: number) {
    const updated = await api.refreshScreenshot(id);
    setLinks((prev) => prev.map((l) => (l.id === id ? updated : l)));
  }

  async function handleArchive(id: number) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    try {
      await api.archive(id);
    } finally {
      refresh();
    }
  }

  async function loadArchive() {
    setArchiveLoading(true);
    try {
      const res = await api.archived();
      setArchivedLinks(res.links);
    } finally {
      setArchiveLoading(false);
    }
  }

  useEffect(() => {
    if (archiveOpen) loadArchive();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [archiveOpen]);

  async function handleUnarchive(id: number) {
    setArchivedLinks((prev) => prev.filter((l) => l.id !== id));
    await api.unarchive(id);
    refresh();
  }

  function handleSaved() {
    setEditingLink(null);
    setCreating(false);
    refresh();
  }

  async function loadTrash() {
    setTrashLoading(true);
    try {
      const res = await api.trash();
      setTrashLinks(res.links);
      setTrashRetentionDays(res.retentionDays);
    } finally {
      setTrashLoading(false);
    }
  }

  useEffect(() => {
    if (trashOpen) loadTrash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trashOpen]);

  async function handleRestore(id: number) {
    setTrashLinks((prev) => prev.filter((l) => l.id !== id));
    await api.restore(id);
    refresh();
  }

  async function handlePurge(id: number) {
    setTrashLinks((prev) => prev.filter((l) => l.id !== id));
    await api.purge(id);
  }

  async function handlePurgeAll() {
    const ids = trashLinks.map((l) => l.id);
    setTrashLinks([]);
    await Promise.all(ids.map((id) => api.purge(id)));
  }

  async function handleSignOut() {
    await api.logout();
    window.location.href = '/';
  }

  return (
    <div className="app-shell">
      <TopBar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        linkCount={links.length}
        onSave={() => setCreating(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        showExplore={!smallScreen}
      />
      <SectionsPanel
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        categories={categories}
        activeCategory={activeCategory}
        onSelectCategory={setActiveCategory}
        onOpenTrash={() => setTrashOpen(true)}
        onOpenArchive={() => setArchiveOpen(true)}
        viewMode={viewMode}
        sort={sort}
        onToggleSort={() => setSort((s) => (s === 'newest' ? 'oldest' : 'newest'))}
        query={query}
        onQueryChange={setQuery}
        userEmail={initialData.user.email}
        onSignOut={handleSignOut}
      />
      <TrashDialog
        open={trashOpen}
        onClose={() => setTrashOpen(false)}
        links={trashLinks}
        retentionDays={trashRetentionDays}
        loading={trashLoading}
        onRestore={handleRestore}
        onPurge={handlePurge}
        onPurgeAll={handlePurgeAll}
      />
      <ArchiveDialog
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        links={archivedLinks}
        loading={archiveLoading}
        onUnarchive={handleUnarchive}
      />

      <main className="main-content">
        {viewMode === 'list' && (
          <ViewModeList
            links={links}
            onEdit={setEditingLink}
            onDelete={handleDelete}
            onRefreshScreenshot={handleRefreshScreenshot}
            onArchive={handleArchive}
          />
        )}
        {viewMode === 'grid' && (
          <ViewModeGrid
            links={links}
            onEdit={setEditingLink}
            onDelete={handleDelete}
            onRefreshScreenshot={handleRefreshScreenshot}
            onArchive={handleArchive}
          />
        )}
        {viewMode === 'explore' && !smallScreen && (
          <Suspense fallback={<div className="explore-view" />}>
            <ViewModeExplore
              links={links}
              searchActive={query.trim().length > 0}
              searchKey={query.trim().toLowerCase()}
              categoryKey={activeCategory}
            />
          </Suspense>
        )}
      </main>

      {(editingLink || creating) && (
        <SaveDialog
          link={editingLink ?? undefined}
          categories={categories}
          onDone={handleSaved}
          onClose={() => {
            setEditingLink(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}
