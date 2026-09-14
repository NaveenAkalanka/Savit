import { useState } from 'react';
import { BookmarkSimple, Check, Compass, Funnel, MagnifyingGlass } from '@phosphor-icons/react';
import { api, ApiRequestError } from '../api.ts';

const FEATURES = [
  {
    icon: BookmarkSimple,
    title: 'Save from anywhere',
    body: 'Drag the bookmarklet into your bar once — save from any page after that, on any site.',
  },
  {
    icon: MagnifyingGlass,
    title: 'Find it instantly',
    body: 'Full-text search across every title, note, and URL — never lose a link in the pile again.',
  },
  {
    icon: Funnel,
    title: 'Organize your way',
    body: 'Categories that actually stay in sync — rename or merge one and every link follows.',
  },
  {
    icon: Compass,
    title: 'Explore your library',
    body: 'Step back and see everything you’ve saved as a living, drag-to-rotate constellation.',
  },
];

export function AuthPage() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await api.signup({ email, password });
      } else {
        await api.login({ email, password });
      }
      // A fresh full load re-runs SSR with the new session cookie, landing on
      // the real dashboard with server-fetched data already in place.
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Something went wrong');
      setSaving(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-layout">
        <div className="auth-brand">
          <div className="auth-brand-lockup">
            <img className="auth-brand-icon" src="/icon-mark.svg" alt="" aria-hidden="true" />
            <img className="auth-brand-logo" src="/logo.svg" alt="Savit" />
          </div>
          <p className="auth-tagline">Your reading list, mapped like a sky.</p>
          <p className="auth-subtagline">
            Save anything, from anywhere, and watch your library become a constellation of its own.
          </p>
          <ul className="auth-features">
            {FEATURES.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon size={18} aria-hidden="true" />
                <div>
                  <div className="auth-feature-title">{title}</div>
                  <div className="auth-feature-body">{body}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-card">
          <h2>{mode === 'signup' ? 'Create account' : 'Sign in'}</h2>
          <form onSubmit={handleSubmit}>
            <div className="field">
              <label>Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoFocus
                required
              />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
            </div>
            {error && <div className="auth-error">{error}</div>}
            <button type="submit" className="auth-submit" disabled={saving}>
              <Check size={14} weight="bold" aria-hidden="true" />
              {saving ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>
          <button
            type="button"
            className="auth-switch"
            onClick={() => {
              setMode((m) => (m === 'signup' ? 'login' : 'signup'));
              setError(null);
            }}
          >
            {mode === 'signup' ? 'Already have an account? Sign in' : "Don't have an account? Create one"}
          </button>
        </div>
      </div>
    </div>
  );
}
