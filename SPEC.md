# Savit — Functional Specification

> **⚠ Historical document.** This was the original design spec, written before
> multi-user accounts, trash, archive, rate-limiting, and the settings page
> existed. In particular, [§5 Auth model](#5-auth-model) is out of date — Savit
> now has its own in-app email/password authentication, not network-layer-only
> access control. For accurate, current setup instructions, see
> [README.md](README.md). This file is kept for the data-model and API-contract
> detail it still gets right, not as a description of the current auth or
> deployment story.

Savit is a self-hosted bookmarking tool for saving the *exact* page URL out of a
browser tab (not just the domain), so open tabs stop being a memory buffer. It is
a deliberate sibling project to another app called **lookmd**, reusing the same
stack and monorepo shape.

This document captures everything about what Savit does and how it is built —
data model, API contract, business logic, auth model, and deployment. It
deliberately excludes visual/UI design decisions (colors, fonts, theme,
component styling) so a rebuild is free to choose new ones.

## 1. Core concept & product behavior

- A user saves the URL of whatever page they're currently on (via a bookmarklet
  or the in-app "+ Save" button), optionally with a category and a note.
- Re-saving a URL that's already stored **upserts** — it refreshes the title and
  cover image but never duplicates the row, and never clobbers a note or
  category the user already set on it.
- Links can be filtered by category and full-text searched (title/url/note/category).
- Categories are drawn from a small user-managed list ("sections") rather than
  free text in the save/edit UI — but the underlying `links.category` column is
  a plain string, normalized (trimmed + lowercased) on write.
- Deleting a link is a two-step confirm (arm, then confirm) in the UI — not
  reflected in the API, which deletes immediately on `DELETE`.
- The dashboard supports multiple view modes for browsing saved links (a dense
  list, card grids at different densities, and a 3D "explore" view) — the exact
  visual treatment of each is a design decision, but the underlying data shown
  is always the same filtered/sorted link list.
- Cover images: a link may have an image URL (auto-detected via `og:image`/
  `twitter:image` at save time, or set manually) and an `imageSource` of
  `auto | url | none`. If the image fails to load client-side (404, hotlink
  block) the UI falls back to a placeholder — this must not trigger a server
  round-trip.
- No user accounts, no login screen, no in-app authentication of any kind —
  see §5 Auth model.

## 2. Monorepo layout

npm workspaces, three packages, no build step for the two non-client ones:

```
savit/
├── .env                    # TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — never committed
├── .gitignore              # must list .env before the first `git add`
├── package.json            # root: workspaces = [shared, server, client]
├── shared/                 # @savit/shared — DTO contract, no build (exports src/ directly)
├── server/                 # @savit/server — Fastify, runs TS source directly (Node type stripping)
└── client/                 # @savit/client — React 19 + Vite 6 + TS
```

Root `package.json` scripts: `dev` (runs server+client concurrently), `dev:server`,
`dev:client`, `build` (builds client only), `test` (runs all workspace tests),
`typecheck` (runs all workspace typechecks). Requires Node ≥ 22.

## 3. Data model (Turso / libSQL)

`server/src/db.ts` owns `initSchema(db)`, called on every server startup,
idempotent (`IF NOT EXISTS` everywhere, safe to re-run).

```sql
CREATE TABLE links (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  url          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL DEFAULT '',
  origin       TEXT NOT NULL,             -- new URL(url).origin, derived server-side
  note         TEXT NOT NULL DEFAULT '',
  category     TEXT NOT NULL DEFAULT '',  -- '' = uncategorized; normalized lowercase/trim
  image_url    TEXT,
  image_source TEXT CHECK(image_source IN ('auto','url','none')) DEFAULT 'none',
  status       TEXT CHECK(status IN ('inbox','archived')) NOT NULL DEFAULT 'inbox',
  created_at   INTEGER NOT NULL,          -- epoch ms
  updated_at   INTEGER NOT NULL           -- epoch ms
);

CREATE VIRTUAL TABLE links_fts USING fts5(
  title, url, note, category, content='links', content_rowid='id'
);
-- + AFTER INSERT/UPDATE/DELETE triggers (links_ai/links_ad/links_au) keeping
--   links_fts in sync with links automatically.

CREATE TABLE sections (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL UNIQUE,        -- normalized lowercase/trim
  created_at INTEGER NOT NULL
);
```

Notes:
- `status` (`inbox`/`archived`) is retained on the row for schema flexibility but
  is **not** user-facing — Savit has no archive workflow in the product today.
- `initSchema` also handles one schema evolution defensively: if `category`
  doesn't exist on an older `links` table, it's added via `ALTER TABLE`, and
  `links_fts` (which can't gain a column in place) is dropped, recreated with
  the new column set, and backfilled from `links`. On first bootstrap of a
  fresh DB this path is a no-op.
- A one-time backfill (`INSERT OR IGNORE ... SELECT DISTINCT category FROM links`)
  promotes any category already present on a link into a real `sections` row,
  so pre-existing categories don't disappear from the picker once sections
  became the source of truth for the category list.

## 4. Shared DTO contract (`shared/src/api.ts`)

Wire shape is camelCase; the server maps to/from the snake_case DB columns.
Both client and server import this module so the contract has exactly one
source of truth.

```ts
type LinkStatus = 'inbox' | 'archived';
type ImageSource = 'auto' | 'url' | 'none';

interface Link {
  id: number;
  url: string;
  title: string;
  origin: string;
  note: string;
  category: string;       // '' = uncategorized
  imageUrl: string | null;
  imageSource: ImageSource;
  status: LinkStatus;
  createdAt: number;      // epoch ms
  updatedAt: number;      // epoch ms
}

interface CreateLinkInput {
  url: string;
  title?: string;
  category?: string;
  imageUrl?: string | null;
  imageSource?: ImageSource; // defaults to 'auto' if imageUrl given, else 'none'
}
type CreateLinkResponse = Link;

interface ListLinksQuery {
  q?: string;
  category?: string;
  sort?: 'newest' | 'oldest'; // default 'newest'
}
interface ListLinksResponse { links: Link[] }

type GetLinkResponse = Link;

interface ListCategoriesResponse { categories: string[] } // distinct, non-empty, in use

interface UpdateLinkInput {
  title?: string;
  note?: string;
  category?: string;
  imageUrl?: string | null;
  imageSource?: ImageSource;
}
type UpdateLinkResponse = Link;

interface DeleteLinkResponse { id: number; deleted: true }

interface Section { id: number; name: string }
interface CreateSectionInput { name: string }
type CreateSectionResponse = Section;
interface ListSectionsResponse { sections: Section[] }
interface DeleteSectionResponse { id: number; deleted: true }

type ApiErrorCode = 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'DB_ERROR';
interface ApiError { error: string; code: ApiErrorCode }
```

## 5. Auth model

**No in-app auth code whatsoever** — no login form, no session/cookie handling,
no middleware. Access control is entirely a network/proxy concern (e.g.
Cloudflare Access or an equivalent in front of the deployed origin). This is a
deliberate simplification: Savit is single-user/self-hosted, and the
bookmarklet's same-origin popup (§8) relies on exactly this — the browser's
existing authenticated session for the Savit origin, whatever gates it, is used
automatically with zero token handling in the app.

## 6. Function layer (`server/src/links.ts`, `server/src/sections.ts`)

Fastify-free, pure functions, every one takes an explicit `db: Client` as its
first argument (never a module-level singleton) — this is what lets tests
inject a local-file libSQL client instead of the real Turso connection.

```
deriveOrigin(url): string                    // new URL(url).origin, throws 400 INVALID_INPUT on invalid
createLink(db, input): Promise<Link>          // derives origin, normalizes category, upserts on UNIQUE(url)
listLinks(db, {category, q, sort}): Promise<Link[]>  // q present → JOIN links_fts WHERE MATCH; else plain WHERE
listCategories(db): Promise<string[]>
getLink(db, id): Promise<Link | null>
updateLink(db, id, patch): Promise<Link>      // dynamic SET clause; throws 404 NOT_FOUND if no row
deleteLink(db, id): Promise<{id, deleted: true}>  // throws 404 NOT_FOUND if rowsAffected === 0

listSections(db): Promise<Section[]>
createSection(db, name): Promise<Section>     // throws 409 CONFLICT on duplicate name
deleteSection(db, id): Promise<{id, deleted: true}>
```

Key behaviors to preserve on rebuild:
- **Upsert, never duplicate**: `createLink`'s INSERT uses
  `ON CONFLICT(url) DO UPDATE SET title=excluded.title, image_url/image_source
  refreshed only if the new save actually supplies an image (excluded.image_source
  != 'none'), updated_at=excluded.updated_at` — critically, `note` and `category`
  are *not* in that SET clause, so user annotations survive a re-save from the
  bookmarklet.
- **FTS query building**: user search input is tokenized on whitespace, each
  token quoted and `"`-escaped, and suffixed `*` for prefix matching, then
  AND-joined (`"foo"* "bar"*`) — this is what makes raw user input (hyphens,
  quotes, FTS5 boolean keywords) safe against MATCH syntax errors.
- **Category normalize**: trim + lowercase, applied identically on link.category,
  section.name, and the `?category=` filter query param, so casing never splits
  a category into two effective filter pills.
- Category list for the filter bar is the *union* of defined sections and
  categories actually present on links (a section with zero links still shows;
  a category orphaned by a deleted section still shows).

## 7. HTTP routes (`server/src/app.ts`)

Fastify 5 app, built as `buildApp(config, db)` (two-arg factory so tests can
inject a local-file DB the same way lookmd's tests inject a temp directory).

```
GET    /api/health              → { ok: true }
POST   /api/links                → 201 Link           (400 INVALID_INPUT if url missing/blank)
GET    /api/links?q&category&sort → { links: Link[] }
GET    /api/links/:id            → Link                (404 NOT_FOUND)
PATCH  /api/links/:id            → Link                (404 NOT_FOUND)
DELETE /api/links/:id            → { id, deleted: true } (404 NOT_FOUND)
GET    /api/categories           → { categories: string[] }
GET    /api/sections             → { sections: Section[] }
POST   /api/sections             → 201 Section         (409 CONFLICT on duplicate)
DELETE /api/sections/:id         → { id, deleted: true } (404 NOT_FOUND)
GET    /*  (non-API)             → index.html (SPA catch-all, single-origin deploy only)
```

Cross-cutting:
- One `onRequest` hook sets `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` on every response
  (incl. errors/static), plus a CSP header when serving the built static client
  (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self';
  object-src 'none'; base-uri 'self'; frame-ancestors 'none'` — `img-src` allows
  arbitrary `https:` because cover images are hotlinked from whatever site a
  link was saved from).
- One `setErrorHandler` maps any thrown error to the shared `ApiError` shape via
  `toApiError()` — an `HttpError` (status+code+message) passes through as-is; a
  Fastify-native 4xx (e.g. malformed JSON body) becomes `INVALID_INPUT`;
  anything else is logged server-side and flattened to `500 DB_ERROR` without
  leaking internal details to the client.
- No `bodyLimit` override — small JSON payloads only, Fastify's 1MB default is fine.
- Static serving (`@fastify/static`, `wildcard: false` + a manual
  `setNotFoundHandler` fallback to `index.html` for any non-`/api` GET) is only
  registered when `config.staticDir` is set *and* exists on disk — unset in
  dev/tests, set in the Docker image.

`server/src/config.ts` — `loadConfig(argv, env)`, precedence CLI flag > env var
> default:
```
--port / SAVIT_PORT       (default 4318)
--host / SAVIT_HOST       (default 127.0.0.1)
SAVIT_STATIC_DIR          (unset by default; set in Docker to /app/client/dist)
TURSO_DATABASE_URL        (required, throws if missing)
TURSO_AUTH_TOKEN          (optional)
```

`server/src/index.ts` — entrypoint: `loadConfig()` → `createDb()` →
`await initSchema(db)` → `buildApp(config, db)` → `app.listen()`.

## 8. Client (React 19 + Vite 6 + TS)

`client/src/api.ts` — typed fetch wrapper (`ApiRequestError`, `unwrap`,
`getJson`/`sendJson`) over every route above, all relative same-origin URLs,
typed against `@savit/shared` end to end.

Route split in `App.tsx`: `window.location.pathname === '/save'` renders
`SavePopup` (the bookmarklet's target), anything else renders the main
`Dashboard`.

**Bookmarklet mechanism — same-origin popup, deliberately not a cross-origin
fetch():**
```js
javascript:(function(){
  var img = document.querySelector('meta[property="og:image"]')?.content
    || document.querySelector('meta[name="twitter:image"]')?.content || '';
  window.open(origin + '/save'
    + '?url=' + encodeURIComponent(location.href)
    + '&title=' + encodeURIComponent(document.title)
    + '&image=' + encodeURIComponent(img),
    'savit-save', 'width=420,height=560');
})();
```
Read client-side so it works even on auth-walled pages a server-side scraper
couldn't reach. `SavePopup` reads `?url&title&image` from `URLSearchParams`,
pre-fills the save form, and on confirm calls `api.create()` then
`window.close()`. This works with zero CORS handling and no token baked into
the bookmarklet, because it's a plain same-origin navigation — whatever
already gates the Savit origin (§5) applies transparently. The bookmarklet
source is kept readable in `client/src/bookmarklet.ts` and minified at
render/build time into the actual draggable `javascript:` link, not
hand-minified.

**Dashboard behavior** (`App.tsx`): loads links/categories/sections in
parallel on mount and whenever the category filter or (debounced, 250ms)
search query changes; delete is optimistic (removed from local state
immediately, then confirmed against the server) with a re-fetch afterward;
save/edit go through modal dialogs that call `api.create`/`api.update` then
refresh the list. Category filter pills are the sorted union of defined
sections and categories actually present on the currently-loaded links.

Image fallback: an `<img onError>` handler flips a local "failed" flag so a
broken/hotlink-blocked cover image swaps to a placeholder without a server
round-trip; `imageUrl === null` renders the placeholder directly with no
network attempt at all.

## 9. Testing strategy

- `server/src/links.test.ts`, `server/src/sections.test.ts`, `server/src/app.test.ts`
  — real SQL against a local libSQL file (`file:` + a temp path via
  `fs.mkdtempSync`), not mocks. Local libSQL is the same SQL engine as hosted
  Turso, so this exercises real queries (including FTS) without a network
  dependency, and runs in plain `node --test`.
- `server/src/links.turso-smoke.test.ts` — opt-in (skipped unless
  `TURSO_DATABASE_URL` is set), runs the same assertions against the *real*
  hosted Turso DB using a reserved test-URL prefix, swept clean afterward via
  `DELETE FROM links WHERE url LIKE ?` regardless of test outcome. Exists to
  confirm FTS5 actually behaves the same way on hosted Turso as on local
  libSQL — the one assumption in the whole design worth verifying empirically
  since it gates search.
- `server/src/db.smoke.ts` — a throwaway one-off ops script (not part of
  `npm test`) for manually confirming a fresh Turso DB accepts the schema.

## 10. Deployment (Docker / Coolify)

Single container serves both the API and the built client on one origin — no
CORS, no reverse-proxy path rewriting needed.

- Multi-stage `Dockerfile`: `node:24-slim` build stage (`npm ci` with manifests
  copied first for cache-friendliness, then `npm run build && npm prune --omit=dev`)
  → `node:24-slim` runtime stage, copying the pruned `node_modules` (incl. the
  `@savit/shared` workspace symlink), `shared/` + `server/` source, and
  `client/dist`. The server runs its TypeScript source directly in the runtime
  image via Node's native type stripping — no server build step.
- **Stateless**: no volume mount — all persistent state lives in Turso, not on
  the container filesystem.
- Runtime env vars: `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (both required,
  secret, provided at deploy time — never baked into the image as defaults);
  `SAVIT_HOST=0.0.0.0`, `SAVIT_PORT=4318`, `SAVIT_STATIC_DIR=/app/client/dist`
  are set as image `ENV` defaults and rarely need overriding.
- `HEALTHCHECK` hits `/api/health` via Node's global `fetch` (no `curl` needed
  in the slim image).
- The one thing worth re-checking per deploy: whichever network/proxy layer
  gates the origin (§5) must actually cover `/save` and `/api/*`, since Savit
  has zero in-app auth — the bookmarklet's real-world value (capturing pages a
  server-side scraper can't reach, incl. auth-walled ones) depends on it.
