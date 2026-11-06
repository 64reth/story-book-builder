# Story Book Builder — Build 001

Local publishing workspace for illustrated storybooks. Next.js 16.4.5 App Router, strict TypeScript, React, Tailwind CSS, Lucide, SQLite (`better-sqlite3`) and Sharp. No hosting service or Canva MCP connection is required.

## Run on Windows

Use PowerShell in `C:\Projects\story-book-builder` with Node.js 24 and npm 11:

```powershell
npm.cmd ci
# Only if .env.local does not exist:
if (-not (Test-Path -LiteralPath .env.local)) { Copy-Item .env.example .env.local }
npm run dev
```

Open **http://127.0.0.1:3000**. Use this exact hostname: API origin checks reject `localhost` when `APP_URL` is `127.0.0.1`. The dev/start scripts bind to loopback. Stop any older `next dev` instance before starting a new one. If PowerShell blocks `npm.ps1`, use `npm.cmd` for all commands.

Set these values in `.env.local`; existing values are never changed by the app:

| Variable                   | Purpose                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `CANVA_CLIENT_ID`          | Client ID from Canva; the supplied app is `OC-AaGxgwv_chxn`.                                 |
| `CANVA_CLIENT_SECRET`      | Client secret from that app; required to connect. Never put it in a `NEXT_PUBLIC_` variable. |
| `CANVA_REDIRECT_URI`       | `http://127.0.0.1:3000/auth/canva/callback` — register exactly in Canva.                     |
| `CANVA_TEMPLATE_DESIGN_ID` | Initial registration; use `DAHaJgBbCJ4` for Automated Template Builder.                      |
| `APP_URL`                  | `http://127.0.0.1:3000`                                                                      |
| `SESSION_SECRET`           | At least 32 random characters. Encrypts tokens and signs owner cookies.                      |

Generate a secret locally if you do not already have one (prints a new value for you to copy):

```powershell
node -e "process.stdout.write(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Restart after changing environment variables. Changing `SESSION_SECRET` makes stored Canva tokens unreadable; reconnect Canva afterward. Do not commit secrets or share the data directory.

## Publishing workflow

1. In **Book Library**, create a 24, 28, 32 or 33 page book. First launch creates **Aves Adventures — Nervous Cake** with 33 blank pages, 8.625 × 8.7 inch dimensions and a 0.375 inch safe margin.
2. Type page copy in the editor or **Import manuscript**. Separate pages with `---` on its own line, or propose a distribution at whole-paragraph boundaries. Review and edit every proposed page before applying it. Import replaces text while retaining illustrations.
3. Upload PNG, JPEG or WebP illustrations in **Asset Library**. Drag/drop and multiple uploads work. Assign in asset details or the editor’s Illustration tab. Replacement updates the asset across books. Deletion requires confirmation and is refused while a book, saved version or publishing history references it.
4. In **Settings**, connect Canva. Configure these scopes in the Canva Developer Portal first: `asset:read`, `asset:write`, `design:content:read`, `design:content:write`, `design:meta:read`.
5. In **Templates**, inspect the actual source design. The app retrieves its dataset and page count, displays actual names/types, and lets you map each page’s fields. Registration is not verification. Expected names for the supplied source are `PAGE_01_IMAGE` / `PAGE_01_TEXT` through `PAGE_33_IMAGE` / `PAGE_33_TEXT`; existence is never assumed. Add labels in Canva’s Bulk Create app if the dataset is empty, then inspect again.
6. Choose the template in book settings or **Publishing**. Run **Validate readiness**. Book/template page counts must match; every dataset field must be mapped once with a compatible type; pages need copy and artwork; effective image resolution must meet the configurable target (300 DPI default). Long copy and final layout checks are warnings. Validation rechecks live template access before starting a job.
7. Select **Generate Canva Draft**. Keep Publishing open to drive uploads and polling. Actual stages and upload counts are shown, with bounded backoff (40 polls maximum per stage). Generation percentage is a local stage indicator, not Canva-reported render progress. Returning here resumes a persisted job after navigation or restart.
8. Only confirmed successful Autofill results with matching generated page counts are marked successful. Open the saved edit URL and finish in Canva. Canva editing URLs expire after 30 days; design IDs remain in history.

The source template owns actual geometry, guides, Lilita One font, pastel bubbles, editable text and layer order. The app sends one text value and one uploaded asset per mapped page and never calls `update_design`. Local crop, position, colour, opacity and font-size controls are preview-only. Verify final crop, overflow, fonts and guides in Canva. Install Lilita One on Windows for a closer local preview; no font download is required to run the app.

## Routes and storage

| Route                  | Screen                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `/`                    | Dashboard and setup progress                                 |
| `/books`               | Search/filter; create, edit, duplicate, archive/restore      |
| `/books/:id`           | Editor; autosave, undo/redo, reorder, import and checkpoints |
| `/assets`              | Upload, rename, assign, replace and protected deletion       |
| `/templates`           | Live dataset inspection and editable field mappings          |
| `/publishing`          | Preflight, durable jobs and design history                   |
| `/settings`            | Canva connection, defaults, print target, themes and storage |
| `/auth/canva/callback` | Server-only OAuth callback                                   |

`/api/[...path]` handles workspace reads, book CRUD/version/validation/publishing actions, asset upload/read/replace/rename/delete, template registration/inspection/mapping, job advancement, settings, connect and disconnect. Mutations require a signed owner session and matching `Origin`. A workspace GET establishes the local session. Credentials are never returned by these endpoints.

`data/storybook.sqlite` uses WAL and automatic migrations from `migrations/`. `001-foundation.sql` defines books, ordered pages, assets, templates, publishing jobs with leases, generated designs, draft versions, settings, encrypted credentials, expiring OAuth states and indexes. Typed JSON documents store entity data; pages have separate ordered rows and book writes are transactional. `src/lib/storage.ts` is the adapter boundary for future database work. A D1 adapter is not included.

Uploads have random server-owned names under ignored `data/uploads/`, outside application source. Images are decoded, auto-oriented and re-encoded to remove unsafe appended content and metadata; single-frame images only, 25 MB limit and 80 megapixel decode limit. Immutable replacement files preserve in-progress publishing snapshots. Old replacement files are retained; garbage collection is not included.

Autosave uses optimistic book revisions to reject stale-tab writes. Undo/redo covers the current editor session (40 grouped states). Save checkpoints through **Draft versions**; restore saves the current draft first. Listings expose the most recent 30 checkpoints. Page count is chosen at creation; create another book to change length.

Back up `data` with the server stopped, plus `.env.local` in secure storage. Restore both to recover encrypted connections. Secrets, databases, uploads, browser reports and private test data are ignored by Git. Optional `STORYBOOK_DATA_DIR` overrides storage for tests or another local directory.

## Canva REST implementation

Contracts checked against official documentation on 6 November 2026:

| Endpoint                                    | Use                                                               |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `https://www.canva.com/api/oauth/authorize` | Authorization Code + PKCE S256, random state, exact redirect      |
| `POST /rest/v1/oauth/token`                 | Server-side Basic client auth, code exchange and refresh rotation |
| `POST /rest/v1/oauth/revoke`                | Revoke token lineage and consent before removing credentials      |
| `GET /rest/v1/designs/{id}`                 | Source/result page counts and edit links                          |
| `GET /rest/v1/designs/{id}/dataset`         | Real field names and types                                        |
| `POST /rest/v1/asset-uploads`               | Binary upload with Base64-name metadata                           |
| `GET /rest/v1/asset-uploads/{id}`           | Poll for confirmed Canva asset ID                                 |
| `POST /rest/v1/autofills`                   | Explicit `create_from_design`, source ID and validated data       |
| `GET /rest/v1/autofills/{id}`               | Poll design generation                                            |

References: [Authentication](https://www.canva.dev/docs/apps/rest-apis/authentication/), [Design dataset](https://www.canva.dev/docs/apps/rest-apis/reference/designs/get-design-dataset/), [Autofill](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/), [Asset uploads](https://www.canva.dev/docs/apps/rest-apis/reference/assets/create-asset-upload-job/).

OAuth state is hashed, owner-bound, expires after ten minutes and is consumed once. PKCE verifiers and tokens use AES-256-GCM derived from `SESSION_SECRET`. Refreshes are coalesced within the supported single Node process to protect rotation. Provider error bodies are never relayed to browsers.

One publishing job runs at a time. Each snapshots the book, template, asset metadata and DPI target. Remote job IDs, uploaded asset IDs, backoff and progress persist. A database lease prevents simultaneous advancement. GET status checks retry with backoff; creation requests are never replayed after an uncertain network outcome or crash. Review Canva before generating again if the outcome is unknown. The app cannot detect unlabeled legacy artwork or verify guides/layer order through dataset inspection.

## Verification

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
# Production local run after build:
npm start
```

Core tests use temporary SQLite storage and mocked Canva responses. They cover persistence across processes, revisions/ordering/versions, image safety/reference protection, OAuth state/PKCE/encryption/refresh, API errors, mappings, preflight and confirmed/failing/interrupted publishing jobs. These are contract tests, not proof of a live Canva connection.

Browser tests start an isolated app on **127.0.0.1:3101**, use `.local/browser-*` storage and a separate `.next-browser` build directory, and never touch real books or credentials. They use installed Chrome on Windows. Without Chrome, run `npx playwright install chromium` first. Tests cover manuscript create/import/save/reload, reordering, checkpoints, asset upload/assignment/replacement/protected deletion, API boundaries, six routes at mobile width and persisted themes. Screenshots go under `.local/`; failure traces go to `test-results/`.

## Build 001 limits

- Local single-owner mode with host/origin/session boundaries. No remote login, multi-user accounts, deployment, cloud storage or background service. Do not expose the dev server publicly.
- Live OAuth/dataset/Autofill verification requires the client secret, matching Developer Portal configuration and owner authorization. Plan, scopes and design permissions can block Canva calls; these appear as errors. No connection, fields or successful jobs are fabricated.
- Publishing advances with the Publishing view open. Uncertain creation requests require review in Canva. Reopen the design by ID in Canva if its saved edit link expires.
- Final typography, dimensions, crop/replacement behaviour and overflow require manual review in Canva. No PDF/PNG export is included; the export setting records a finishing preference.
- Checkpoints preserve copy, ordering, assignments and preview settings. They do not duplicate asset bytes: replacement changes the current asset in books and versions. Publishing snapshots retain original bytes.
- Replacement-file cleanup, checkpoint pruning and automated backups are deferred. Native SQLite binaries must match Node and platform.
