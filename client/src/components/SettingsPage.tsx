import { useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import type { Link, Section } from '@savit/shared';
import {
  ArrowLeft,
  ArrowsLeftRight,
  Check,
  Coffee,
  Database,
  Devices,
  DownloadSimple,
  FolderSimple,
  PencilSimple,
  Plus,
  SignOut,
  UserCircle,
  X,
} from '@phosphor-icons/react';
import type { SettingsInitialData } from '../types.ts';
import { api, ApiRequestError } from '../api.ts';
import { DeleteConfirm } from './DeleteConfirm.tsx';
import { BulkDeleteDialog } from './BulkDeleteDialog.tsx';

type PanelKey = 'account' | 'categories' | 'data';

const NAV_ITEMS: {
  key: PanelKey;
  label: string;
  icon: ComponentType<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;
}[] = [
  { key: 'account', label: 'Account', icon: UserCircle },
  { key: 'categories', label: 'Categories', icon: FolderSimple },
  { key: 'data', label: 'Data', icon: Database },
];

const PANEL_COPY: Record<PanelKey, { title: string; description: string }> = {
  account: { title: 'Account', description: 'Your sign-in, sessions, and credentials.' },
  categories: { title: 'Categories', description: 'Rename, merge, or remove the groups your links are organized into.' },
  data: { title: 'Data', description: 'Export everything you’ve saved, or make changes across many links at once.' },
};

export function SettingsPage({ initialData }: { initialData: SettingsInitialData }) {
  const { user } = initialData;
  const [active, setActive] = useState<PanelKey>('account');

  const [sections, setSections] = useState<Section[]>(initialData.sections);
  const [categories, setCategories] = useState<string[]>(initialData.categories);
  const [links, setLinks] = useState<Link[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);

  useEffect(() => {
    api.list({}).then((res) => setLinks(res.links));
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && bulkOpen) setBulkOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [bulkOpen]);

  const categoryLinkCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const link of links) {
      if (!link.category) continue;
      counts[link.category] = (counts[link.category] ?? 0) + 1;
    }
    return counts;
  }, [links]);

  function refreshLinksAndCategories() {
    Promise.all([api.list({}), api.categories()]).then(([linksRes, categoriesRes]) => {
      setLinks(linksRes.links);
      setCategories(categoriesRes.categories);
    });
  }

  async function handleCreateSection(name: string) {
    const section = await api.createSection({ name });
    setSections((prev) => [...prev, section].sort((a, b) => a.name.localeCompare(b.name)));
    setCategories((prev) => (prev.includes(section.name) ? prev : [...prev, section.name].sort()));
  }

  async function handleRenameSection(id: number, name: string) {
    const updated = await api.updateSection(id, { name });
    setSections((prev) => [...prev.filter((s) => s.id !== id), updated].sort((a, b) => a.name.localeCompare(b.name)));
    refreshLinksAndCategories();
  }

  async function handleDeleteSection(id: number, reassignTo?: string) {
    await api.removeSection(id, reassignTo);
    setSections((prev) => prev.filter((s) => s.id !== id));
    refreshLinksAndCategories();
  }

  async function handleSignOut() {
    await api.logout();
    window.location.href = '/';
  }

  return (
    <div className="settings-page">
      <header className="settings-page-header">
        <a className="settings-back" href="/">
          <ArrowLeft size={14} aria-hidden="true" />
          Back to Library
        </a>
        <div className="settings-page-brand">
          <img className="settings-page-brand-icon" src="/icon-mark.svg" alt="" aria-hidden="true" />
          <img className="settings-page-brand-logo" src="/logo.svg" alt="Savit" />
        </div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav">
          {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              className={`settings-nav-item${active === key ? ' active' : ''}`}
              onClick={() => setActive(key)}
            >
              <Icon size={14} aria-hidden="true" />
              {label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <h1 className="settings-page-title">{PANEL_COPY[active].title}</h1>
          <p className="settings-page-description">{PANEL_COPY[active].description}</p>

          {active === 'account' && <AccountPanel email={user.email} onSignOut={handleSignOut} />}

          {active === 'categories' && (
            <CategoriesPanel
              sections={sections}
              categoryLinkCounts={categoryLinkCounts}
              onCreateSection={handleCreateSection}
              onRenameSection={handleRenameSection}
              onDeleteSection={handleDeleteSection}
            />
          )}

          {active === 'data' && <DataPanel onOpenBulkActions={() => setBulkOpen(true)} />}
        </div>
      </div>

      <footer className="settings-page-footer">
        <AboutPanel />
      </footer>

      <BulkDeleteDialog
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        onLinksChanged={refreshLinksAndCategories}
        categories={categories}
      />
    </div>
  );
}

function AccountPanel({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [currentPasswordForEmail, setCurrentPasswordForEmail] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSaving, setEmailSaving] = useState(false);

  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPasswordForPw, setCurrentPasswordForPw] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaving, setPasswordSaving] = useState(false);

  const [signingOutOthers, setSigningOutOthers] = useState(false);
  const [signedOutOthersMessage, setSignedOutOthersMessage] = useState<string | null>(null);

  async function handleSignOutOthers() {
    setSigningOutOthers(true);
    setSignedOutOthersMessage(null);
    try {
      await api.logoutOthers();
      setSignedOutOthersMessage('Every other device has been signed out.');
    } catch {
      setSignedOutOthersMessage('Something went wrong — try again.');
    } finally {
      setSigningOutOthers(false);
    }
  }

  async function handleChangeEmail(e: React.FormEvent) {
    e.preventDefault();
    setEmailSaving(true);
    setEmailError(null);
    try {
      await api.changeEmail({ currentPassword: currentPasswordForEmail, newEmail });
      window.location.href = '/';
    } catch (err) {
      setEmailError(err instanceof ApiRequestError ? err.message : 'Something went wrong');
      setEmailSaving(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordSaving(true);
    setPasswordError(null);
    try {
      await api.changePassword({ currentPassword: currentPasswordForPw, newPassword });
      window.location.href = '/';
    } catch (err) {
      setPasswordError(err instanceof ApiRequestError ? err.message : 'Something went wrong');
      setPasswordSaving(false);
    }
  }

  return (
    <>
      <div className="settings-card">
        <h2 className="settings-card-title">Signed in</h2>
        <p className="settings-about">
          You&rsquo;re signed in as <strong>{email}</strong>.
        </p>
        <div className="settings-card-actions">
          <button type="button" className="sidebar-sort" onClick={onSignOut}>
            <SignOut size={12} aria-hidden="true" />
            Switch account
          </button>
          <button type="button" className="sidebar-sort" onClick={handleSignOutOthers} disabled={signingOutOthers}>
            <Devices size={12} aria-hidden="true" />
            {signingOutOthers ? 'Signing out other devices…' : 'Sign out of all other devices'}
          </button>
        </div>
        {signedOutOthersMessage && <p className="settings-hint">{signedOutOthersMessage}</p>}
      </div>

      <div className="settings-card">
        <h2 className="settings-card-title">Email address</h2>
        {showEmailForm ? (
          <form className="settings-credential-form settings-credential-form--flush" onSubmit={handleChangeEmail}>
            <div className="field">
              <label>Current password</label>
              <input
                type="password"
                value={currentPasswordForEmail}
                onChange={(e) => setCurrentPasswordForEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label>New email</label>
              <input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} required />
            </div>
            {emailError && <div className="auth-error">{emailError}</div>}
            <div className="settings-credential-actions">
              <button type="submit" className="icon-btn" disabled={emailSaving}>
                <Check size={12} aria-hidden="true" />
                {emailSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setShowEmailForm(false);
                  setEmailError(null);
                  setCurrentPasswordForEmail('');
                  setNewEmail('');
                }}
              >
                <X size={12} aria-hidden="true" />
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <>
            <p className="settings-about">Change the email you sign in with.</p>
            <button type="button" className="settings-link-btn" onClick={() => setShowEmailForm(true)}>
              Change email address
            </button>
          </>
        )}
      </div>

      <div className="settings-card">
        <h2 className="settings-card-title">Password</h2>
        {showPasswordForm ? (
          <form className="settings-credential-form settings-credential-form--flush" onSubmit={handleChangePassword}>
            <div className="field">
              <label>Current password</label>
              <input
                type="password"
                value={currentPasswordForPw}
                onChange={(e) => setCurrentPasswordForPw(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
            </div>
            {passwordError && <div className="auth-error">{passwordError}</div>}
            <div className="settings-credential-actions">
              <button type="submit" className="icon-btn" disabled={passwordSaving}>
                <Check size={12} aria-hidden="true" />
                {passwordSaving ? 'Saving…' : 'Save'}
              </button>
              <button
                type="button"
                className="icon-btn"
                onClick={() => {
                  setShowPasswordForm(false);
                  setPasswordError(null);
                  setCurrentPasswordForPw('');
                  setNewPassword('');
                }}
              >
                <X size={12} aria-hidden="true" />
                Cancel
              </button>
            </div>
            <p className="settings-hint">Changing your password signs you out everywhere.</p>
          </form>
        ) : (
          <>
            <p className="settings-about">Update the password you sign in with.</p>
            <button type="button" className="settings-link-btn" onClick={() => setShowPasswordForm(true)}>
              Change password
            </button>
          </>
        )}
      </div>
    </>
  );
}

function CategoriesPanel({
  sections,
  categoryLinkCounts,
  onCreateSection,
  onRenameSection,
  onDeleteSection,
}: {
  sections: Section[];
  categoryLinkCounts: Record<string, number>;
  onCreateSection: (name: string) => void;
  onRenameSection: (id: number, name: string) => void;
  onDeleteSection: (id: number, reassignTo?: string) => void;
}) {
  const [newSectionName, setNewSectionName] = useState('');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [reassigningId, setReassigningId] = useState<number | null>(null);
  const [reassignTarget, setReassignTarget] = useState('');

  function handleAddSection(e: React.FormEvent) {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    onCreateSection(newSectionName);
    setNewSectionName('');
  }

  function startRename(section: Section) {
    setReassigningId(null);
    setEditingId(section.id);
    setEditingName(section.name);
  }

  function handleRenameSubmit(e: React.FormEvent, id: number) {
    e.preventDefault();
    if (!editingName.trim()) return;
    onRenameSection(id, editingName);
    setEditingId(null);
  }

  function startReassign(section: Section) {
    setEditingId(null);
    setReassigningId(section.id);
    setReassignTarget('');
  }

  function handleReassignAndDelete(section: Section) {
    onDeleteSection(section.id, reassignTarget);
    setReassigningId(null);
  }

  return (
    <div className="settings-card">
      <form className="section-add-row" onSubmit={handleAddSection}>
        <input
          value={newSectionName}
          onChange={(e) => setNewSectionName(e.target.value)}
          placeholder="New category"
        />
        <button type="submit" className="icon-btn" title="Add category" aria-label="Add category">
          <Plus size={12} aria-hidden="true" />
        </button>
      </form>

      {sections.length === 0 ? (
        <p className="settings-about">No categories yet — add one above.</p>
      ) : (
        <div className="section-list">
          {sections.map((section) => {
            const linkedCount = categoryLinkCounts[section.name] ?? 0;
            return (
              <div key={section.id} className="section-row">
                {editingId === section.id ? (
                  <form className="settings-rename-form" onSubmit={(e) => handleRenameSubmit(e, section.id)}>
                    <input value={editingName} onChange={(e) => setEditingName(e.target.value)} autoFocus />
                    <button type="submit" className="icon-btn" title="Save" aria-label="Save">
                      <Check size={12} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setEditingId(null)}
                      title="Cancel"
                      aria-label="Cancel"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </form>
                ) : reassigningId === section.id ? (
                  <div className="settings-rename-form">
                    <select value={reassignTarget} onChange={(e) => setReassignTarget(e.target.value)}>
                      <option value="">Uncategorized</option>
                      {sections
                        .filter((s) => s.id !== section.id)
                        .map((s) => (
                          <option key={s.id} value={s.name}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleReassignAndDelete(section)}
                      title="Move linked records and delete this category"
                      aria-label="Move and delete"
                    >
                      <Check size={12} aria-hidden="true" />
                      Move &amp; delete
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setReassigningId(null)}
                      title="Cancel"
                      aria-label="Cancel"
                    >
                      <X size={12} aria-hidden="true" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span>{section.name}</span>
                    <div className="settings-section-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => startRename(section)}
                        title="Rename category"
                        aria-label="Rename category"
                      >
                        <PencilSimple size={12} aria-hidden="true" />
                      </button>
                      {linkedCount > 0 ? (
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => startReassign(section)}
                          title={`${linkedCount} linked record(s) — reassign them to delete this category`}
                          aria-label="Reassign linked records"
                        >
                          <ArrowsLeftRight size={12} aria-hidden="true" />
                          {linkedCount}
                        </button>
                      ) : (
                        <DeleteConfirm onConfirm={() => onDeleteSection(section.id)} />
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DataPanel({ onOpenBulkActions }: { onOpenBulkActions: () => void }) {
  const [exporting, setExporting] = useState(false);

  async function handleExport() {
    setExporting(true);
    try {
      const [inboxRes, archivedRes, sectionsRes] = await Promise.all([
        api.list({}),
        api.archived(),
        api.sections(),
      ]);
      const payload = {
        exportedAt: new Date().toISOString(),
        links: [...inboxRes.links, ...archivedRes.links],
        sections: sectionsRes.sections,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `savit-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <div className="settings-card">
        <h2 className="settings-card-title">Export</h2>
        <p className="settings-about">Download every link and category you&rsquo;ve saved as a single JSON file.</p>
        <button type="button" className="sidebar-sort" onClick={handleExport} disabled={exporting}>
          <DownloadSimple size={12} aria-hidden="true" />
          {exporting ? 'Exporting…' : 'Export as JSON'}
        </button>
      </div>

      <div className="settings-card">
        <h2 className="settings-card-title">Bulk actions</h2>
        <p className="settings-about">Select many links at once to move them to a category or delete them.</p>
        <button type="button" className="sidebar-sort" onClick={onOpenBulkActions}>
          <ArrowsLeftRight size={12} aria-hidden="true" />
          Open bulk actions
        </button>
      </div>
    </>
  );
}

function AboutPanel() {
  return (
    <div className="settings-footer-inner">
      <div className="settings-footer-brand">
        <img className="settings-footer-brand-icon" src="/icon-mark.svg" alt="" aria-hidden="true" />
        <img className="settings-footer-brand-logo" src="/logo.svg" alt="Savit" />
      </div>
      <p className="settings-footer-credit">
        Designed &amp; developed by <strong>Naveen Akalanka</strong>, under the MIT License.
      </p>
      <a
        className="settings-coffee-link"
        href="https://buymeacoffee.com/naveenakalanka"
        target="_blank"
        rel="noopener noreferrer"
      >
        <Coffee size={14} aria-hidden="true" />
        Buy me a coffee
      </a>
    </div>
  );
}
