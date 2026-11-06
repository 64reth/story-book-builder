# Build 001 delivery

Verified locally on 6 November 2026. Application: **http://127.0.0.1:3000**.

## Implemented

- Responsive editorial workspace with light/dark themes and Lucide icons.
- Dashboard with real book/page/illustration totals, connection status and publishing history.
- Searchable library with creation, metadata editing, duplication and archiving/restoration.
- Editor with ordered thumbnails, proportional page previews and safe guides, copy/artwork assignment, previous/next, page movement, autosave, optimistic revision checks, grouped undo/redo and saved draft versions.
- Manuscript import using explicit page breaks or paragraph-boundary proposals, with editable review before applying.
- Multiple/drag-and-drop PNG, JPEG and WebP uploads, decoded image metadata, rename, assignment, replacement and confirmed/protected deletion.
- Template registration, real dataset/metadata retrieval, field/type inspection and editable mapping checks.
- OAuth Authorization Code + PKCE S256, owner-bound expiring single-use state, encrypted server-side tokens, coalesced rotating refreshes, reconnect and remote revocation.
- Readiness validation including live source access, page/field compatibility, copy/artwork, local file availability and configurable print resolution; warnings separate from blockers.
- Real REST upload and create-from-design Autofill implementations, persisted immutable job snapshots, leased advancement, bounded polling/backoff, uncertainty handling, confirmed result/page-count verification and generated design history.
- Preferences for dimensions, typeface, print DPI, theme and manual finishing export format.

## Routes

`/`, `/books`, `/books/:id`, `/assets`, `/templates`, `/publishing`, `/settings`, `/auth/canva/callback`. Typed local API handlers are under `/api/[...path]`.

## Database

SQLite through `better-sqlite3`, WAL mode, migrations and a separate storage adapter. Migration 001 defines books, ordered pages, assets, templates, publishing jobs, generated designs, versions, settings, credentials, OAuth states and indexes. Migration bookkeeping has its own table. Data and immutable image files live under ignored `data/`. See [README](../README.md) and [migration](../migrations/001-foundation.sql).

## Canva endpoints

Authorization at `https://www.canva.com/api/oauth/authorize`; REST base `https://api.canva.com/rest/v1`:

- `POST /oauth/token`, `POST /oauth/revoke`
- `GET /designs/{id}`, `GET /designs/{id}/dataset`
- `POST /asset-uploads`, `GET /asset-uploads/{id}`
- `POST /autofills` with explicit `create_from_design`, `GET /autofills/{id}`

Schemas and the five required scope identifiers were checked against official Canva documentation linked in the README. No source-template update endpoint is called.

## Actual local state

- The real service returned HTTP 200 at `127.0.0.1:3000`.
- Configuration is populated; no existing secret value was overwritten.
- OAuth initiation returned HTTP 200 with Canva’s authorization host, S256, the requested five scopes and `http://127.0.0.1:3000/auth/canva/callback`.
- The account is **not authorized/connected**. No access token or live template dataset was available for this verification.
- `DAHaJgBbCJ4` is registered as Automated Template Builder, with actual page count/dataset explicitly unverified.
- The initial Aves Adventures — Nervous Cake book has 33 blank pages, 8.625 × 8.7 inch dimensions and a 0.375 inch safe margin. There are no real publishing jobs.
- Its preflight returned **68 blocking errors and 1 review warning**: missing Canva connection, missing template selection, 33 missing texts and 33 missing illustrations. It cannot publish in this state.

## Executed verification

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm test` | 19 passed |
| `npm run build` | Passed; Next.js production bundle generated |
| `npm run dev` | Executed; existing local instance detected and verified at the requested URL |
| `npm run test:browser` | 4 Chrome workflows passed; isolated server on port 3101 |
| Git exclusions | Secrets, SQLite, uploads and private test artifacts ignored |

Core tests use temporary SQLite files and mocked Canva responses. Browser tests use isolated databases and no real Canva credentials. Screenshots inspected at desktop and mobile sizes; editor preview aspect ratio also asserted at 1440px and 390px. Tests do not prove live Canva account access or successful real generation.

## Limits and next owner action

Use **Settings → Connect Canva**, authorize the account, then **Templates → Inspect live dataset**. Validate the real mappings and page count before populating and publishing a book. Canva may reject access based on app scopes, plan or design permissions.

The Canva template owns the final size, typography, bubbles, crop and layer order. Local overlay controls are preview-only. Dataset inspection cannot confirm unlabeled old artwork, guides or actual text overflow. Review the generated design in Canva before print. Saved edit links expire after 30 days.

Publishing advances with its screen open and resumes when reopened. Unknown creation outcomes require checking Canva before trying again. One Node process/owner and one active publishing job are supported. Multi-user auth, D1/cloud hosting, direct PDF/PNG export, background workers, automatic backups and replacement-file cleanup are deferred. Draft checkpoints reference current asset IDs; publishing snapshots preserve original image files.

No remote push or deployment was performed. The requested local baseline commit hash is reported in the delivery message and is available through `git log -1 --oneline`.
