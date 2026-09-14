<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/icon.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/icon.svg">
    <img src=".github/assets/icon.svg" width="84" alt="Savit icon">
  </picture>
</p>

<h1 align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/assets/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/assets/logo-light.svg">
    <img src=".github/assets/logo-light.svg" width="220" alt="Savit">
  </picture>
</h1>

<p align="center"><em>Your reading list, mapped like a sky.</em></p>

<p align="center">
  <img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue.svg">
  <img alt="Node 22+" src="https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg">
</p>

---

## What Savit solves

Browser tabs are not a filing system. Every open-tabs-forever habit is really
a memory buffer standing in for something that should have been saved
properly — and once fifty tabs deep, the *exact* page you meant to come back
to is impossible to find again.

Savit is a self-hosted place to actually save those pages: the precise URL
(not just the domain), captured in one click from wherever you found it —
including pages behind a login that no "share to save" service could ever
reach — then organized, searched, and browsed properly instead of dumped into
a single unsorted list.

## Features

- **Save from anywhere** — a bookmarklet captures the exact URL, title, and
  a cover image with one click, even on auth-walled pages.
- **Three ways to browse** — a dense list, an image grid, and an interactive
  3D "constellation" view you can drag to rotate.
- **Full-text search** across titles, URLs, notes, and categories.
- **Categories** — create, rename, merge, and bulk-recategorize.
- **Trash** (30-day retention, auto-purged) and **Archive** (out of the way
  without deleting).
- **Multi-user accounts**, each with fully isolated data — sign up, sign in,
  change your email/password, sign out of other devices, and login attempts
  are rate-limited.
- **Export** your entire library as a JSON file whenever you want a backup.
- **Installable as a PWA** on desktop or mobile.
- **Keyboard shortcuts** — `/` to search, `Esc` to back out of whatever's open.

## Getting started

### Prerequisites

- Node.js 22 or newer
- A [Turso](https://turso.tech/) database (the free tier is enough). Create
  one with the [Turso CLI](https://docs.turso.tech/cli/installation) or their
  dashboard, and note its **database URL** and an **auth token**.

### Install

```bash
git clone https://github.com/NaveenAkalanka/Savit.git
cd Savit
npm install
```

### Configure

```bash
cp .env.example .env
```

Then open `.env` and fill in your own Turso credentials:

```
TURSO_DATABASE_URL=libsql://your-database-name.turso.io
TURSO_AUTH_TOKEN=your-turso-auth-token
```

The database schema is created automatically the first time the server
starts — there's no separate migration step to run.

### Run it (development)

```bash
npm run dev
```

Visit `http://localhost:4318`, sign up, and start saving links. The very
first account created becomes the app's initial owner.

**On Windows**, `run.bat` is a convenience wrapper around the same command
that also binds to `0.0.0.0` and prints the URL other devices on your network
can use to reach it. `stop.bat` stops it.

### Run it (production build)

`npm run dev` runs Vite's dev server underneath — fine for personal/LAN use,
but build and serve the optimized bundle for anything more permanent:

```bash
npm run build
```

Then start the server with `SAVIT_STATIC_DIR` pointing at the built client,
so it serves the compiled assets directly instead of running Vite:

```bash
# macOS/Linux
SAVIT_HOST=0.0.0.0 SAVIT_STATIC_DIR="$(pwd)/client/dist/client" npm run start --workspace server

# Windows PowerShell
$env:SAVIT_HOST="0.0.0.0"; $env:SAVIT_STATIC_DIR="$PWD\client\dist\client"; npm run start --workspace server
```

Put a reverse proxy (nginx, Caddy, Cloudflare Tunnel, etc.) in front of it and
terminate TLS there if you're exposing this beyond a trusted local network —
see [Known limitations](#known-limitations).

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `TURSO_DATABASE_URL` | Yes | — | Your Turso (or local `file:`) database URL |
| `TURSO_AUTH_TOKEN` | For hosted Turso | — | Turso auth token |
| `SAVIT_PORT` | No | `4318` | |
| `SAVIT_HOST` | No | `127.0.0.1` | Set to `0.0.0.0` to accept LAN/external connections |
| `SAVIT_STATIC_DIR` | No | unset | Path to the built client (`client/dist/client`) — set this to run in production mode instead of dev mode |

## User guide

**Signing up.** The first account you create automatically becomes the
owner of the instance. After that, anyone who signs up gets their own
private library — nobody can see or touch another account's links.

**Saving a link.** Open Settings from the sidebar and drag the bookmarklet
into your browser's bookmarks bar once. From then on, click it on any page
to open a small save dialog pre-filled with that page's URL, title, and
cover image — edit anything, pick a category, and save.

**Browsing your library.** Switch between **List** (dense, sortable),
**Grid** (visual, cover-image-first), and **Explore** (a 3D field of your
links you can drag to rotate and click into) from the top bar. Press `/`
at any time to jump to search; `Esc` backs out of whatever's currently open.

**Organizing.** Filter by category from the sidebar, or manage categories
entirely — rename, merge one into another, or delete — from
**Settings → Categories**. Need to move or delete many links at once?
**Settings → Data → Open bulk actions**.

**Trash & Archive.** Deleting a link sends it to **Trash**, where it sits
for 30 days before being purged automatically (or restore it any time before
then). **Archive** is for links you want out of your main view without
deleting them — archive from a link's menu, unarchive from the sidebar's
Archive panel.

**Account & security.** From **Settings → Account** you can change your
email or password, and sign out of every other device without changing your
password. Repeated failed logins are automatically rate-limited.

**Backing up.** **Settings → Data → Export as JSON** downloads everything
you've saved — every link, its category, and your defined categories — as a
single file.

## Known limitations

Savit is built for personal/self-hosted use, not as a multi-tenant SaaS.
Before exposing an instance beyond your own trusted network, be aware:

- **No TLS built in** — put a reverse proxy in front of it and terminate
  HTTPS there if it's reachable outside your LAN.
- **Session cookies are not marked `secure`** — fine behind a plain-HTTP LAN
  setup, but flip this once you're serving over HTTPS (`isSecureCookie` in
  `server/src/app.ts`).
- No password reset / account recovery flow yet — losing your password means
  losing access to that account's data.
- No 2FA, no shared/team libraries, no automated backups (use the JSON
  export as a manual one).

## Tech stack

- **Server**: [Fastify 5](https://fastify.dev/), [libSQL/Turso](https://turso.tech/)
- **Client**: React 19 (SSR + hydration), [Vite 6](https://vite.dev/), TypeScript
- **3D view**: [react-three-fiber](https://docs.pmnd.rs/react-three-fiber) / three.js
- npm workspaces monorepo: `shared` (types shared by client & server), `server`, `client`

## License

MIT — see [LICENSE](LICENSE).
