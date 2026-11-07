# Cloudflare migration and release status

## Current result

The application has a tested vinext Workers build, portable asynchronous persistence, D1/R2 adapters, hosted owner authentication, and a scoped migration helper. **Hosted deployment is not yet verified.** Cloudflare R2 remains disabled on the authorised account: its API returns HTTP 403, error **10042**, “Please enable R2 through the Cloudflare Dashboard.” The owner must complete that account/billing step. No workaround substitutes transient filesystem storage.

| Item | Actual status |
| --- | --- |
| Repository | `64reth/story-book-builder`, branch `main` |
| Staging D1 | Created: `story-book-builder-staging` |
| D1 ID | `67d9f434-bc57-4df3-9921-c7b0cd49bbd4` |
| D1 metadata | Imported and independently compared against all source rows in eight metadata tables |
| Staging R2 | Planned `story-book-builder-staging-artwork`; not created while account R2 is disabled |
| Staging Worker | Planned `story-book-builder-staging`; not deployed/verified yet |
| Staging address | Intended `https://story-book-builder-staging.garetha81.workers.dev`; not a claimed live deployment |
| Deployment ID | None |
| Production Worker | Intended `story-book-builder`; not deployed |
| Production address | Intended `https://storybookbuilder.allencreativetechnologies.uk`; not deployed |
| Production zone | `allencreativetechnologies.uk` is active in the authorised account; no DNS changes were made |
| Canva callbacks | Owner confirmed all three exact redirects are registered, including localhost |
| Hosted OAuth | Pending actual staging deployment and owner authorization; no live hosted connection claimed |

## Runtime and storage

`storage.ts` defines the asynchronous SQL boundary. `storage-local.ts` retains SQLite for local development, while `platform-worker.ts` supplies D1. Transactions collect mutations into an atomic backend batch. A revision guard aborts stale read/modify/write batches before their writes run. Regression coverage verifies that a concurrent winner is preserved and no partial loser writes escape. SQLite and D1 use the same migration files; no reset or destructive data conversion is performed.

`artwork-store.ts` stores and retrieves immutable objects through R2 in Workers, and local files only through the local adapter. A missing Worker R2 binding raises an explicit error and cannot fall back to a filesystem. Native SQLite/libvips dependencies are excluded from the Worker dependency graph through platform aliases. The local codec retains Sharp normalization; the Worker codec validates supported image metadata, size/dimensions and single-frame/container boundaries while preserving original bytes. It does not run a native image decoder. The workerd test uploads an image through the real API, checks its R2 object and verifies the returned bytes.

New migrations add only a transaction revision guard and a distributed Canva refresh lease. The lease serialises rotating-token refreshes across Worker isolates, supplementing local in-process promise coalescing. Existing credential encryption remains AES-256-GCM with the established format; native Workers Node compatibility was exercised for encrypted PKCE state creation and consumption. Hosted owner password verification uses Web Crypto PBKDF2. Secrets are environment-specific bindings, never frontend configuration.

The source SQLite database, uploads, all existing projects and local OAuth credential were retained. A consistent backup is ignored at `.local/pre-cloudflare.sqlite`. Before/after hashes confirmed every original database row, `.env.local` and uploaded file content unchanged during preparation. Import copied 2 books, 66 pages, 44 asset records, 1 template, 2 jobs, 2 generated-design records, 2 versions and the existing settings record. Staging D1 verification compared row content, not just counts; ignored evidence is `.local/staging-d1-verification.json`.

Rotating OAuth credentials and session-bound OAuth states are deliberately not cloned into multiple environments: independent hosted authorization avoids competing refresh-token rotations with localhost. The D1 credential/state tables are ready to persist hosted tokens after that authorization. Local encrypted tokens and localhost configuration were not changed.

## Owner-only access

Public visitors cannot obtain workspace data, manuscripts, artwork, jobs or publishing responses. Hosted `/api/workspace` requires an existing signed owner cookie before initialization; it never automatically grants a remote visitor an owner session. All remaining API operations have the same owner check. Writes enforce the exact application Origin. OAuth callbacks require the signed owner cookie and one-time owner-bound PKCE state.

`/login` verifies an environment-specific random owner password against a PBKDF2 hash, records bounded sign-in attempts in D1, and issues an HttpOnly/SameSite cookie with Secure enabled on hosted HTTPS. Unconfigured authentication fails closed. The password and secret upload file are ignored under `.local/staging-owner-access.json` and `.local/staging-worker-secrets.json`; no secret values are included in this report. The user will need the owner password for hosted sign-in after deployment.

## Supported toolchain and commands

Pinned: vinext 1.4.4, `@vinext/cloudflare` 1.3.3, Cloudflare Vite plugin `2.0.0-beta.v.12`, `cf` 1.0.0-beta.28, Vite 8.3.6 and React/RSC 19.3.1. A project-local Node 24.22 satisfies the CLI requirement without changing system Node or other projects.

The [current vinext deployment guide](https://vinext.dev/docs/deploying/cloudflare) uses `cloudflare.config.ts`, Cloudflare Vite plugin v2 and the `vinext-cloudflare deploy` command. The installed initializer originally resolved a v1 plugin despite the new setup; pinning the exact v2 preview produced the native `.cloudflare/output/v0` Worker build. The old CSS loader and incomplete Next cache options were removed. The app uses its existing plain CSS; no replacement frontend was created. `vinext check` now reports **100% compatibility**.

PowerShell commands:

```powershell
npm.cmd run dev                 # Existing localhost + SQLite development
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:browser
npm.cmd run check:vinext
npm.cmd run build               # Staging-mode Workers production build
npm.cmd run test:worker         # Isolated workerd + simulated D1/R2 smoke
```

After R2 is enabled, the remaining staging operations are:

```powershell
node_modules/node/bin/node.exe node_modules/cf/bin/cf r2 buckets create --name story-book-builder-staging-artwork --location-hint weur --mode staging
node_modules/node/bin/node.exe scripts/cloudflare-data.mjs artwork
npm.cmd run deploy:staging
node_modules/node/bin/node.exe scripts/cloudflare-data.mjs secrets
```

The migration helper is explicitly scoped to this account's new staging resources. It preserves local files and rows, uses idempotent metadata inserts, validates object keys and withholds secret values. Initial deployment must remain fail-closed until the four secret bindings are installed. The CLI may require secret provisioning during the initial deployment; do not claim successful startup until that configuration and hosted testing are complete.

Then verify actual HTTPS, owner login, all workspace operations, D1/R2 save/reload, callback completion, live dataset retrieval, non-destructive publishing validation/recovery and result links. Complete hosted Canva OAuth interactively as the owner. Do not create or refine a real Canva design merely as an automated test. Existing copies `DAHaKl_mkXU` and `DAHaK2Bh7W8` must still be explicitly selected after live account/book association checks; neither is guessed as the target.

Production deployment is gated by `scripts/release-production.mjs`. It requires evidence for the same Git HEAD that staging passed all hosted checks, dedicated migrated production storage and availability of the exact DNS name. No production Worker, DNS route or unrelated resource was modified during this work.

## Verification evidence and limits

- ESLint and TypeScript passed.
- 54 automated tests passed, including field review, no-change detection, partial updates, incompatible destination/ownership rejection, protected master behavior, async failures, import planning and atomic rollback.
- 19 Chrome tests passed; desktop import/edit/persistence workflows were exercised at both requested desktop sizes.
- Workers production build passed. Some upstream vinext/RSC source-map and icon optimization warnings remain non-fatal.
- `vinext check`: 100%, zero partial/unsupported findings.
- Compiled workerd runtime smoke passed: anonymous denial, owner Web Crypto login, D1 create/save/read, R2 upload/read, Origin rejection, OAuth redirect construction, AES-GCM state portability and invalid/declined state handling. All resources were isolated simulations; this is not hosted verification.
- The reported high-severity Vite advisory was fixed with 8.3.6. npm still reports 13 moderate dependency advisories; no force upgrade was applied.
- No live Canva create/update, hosted OAuth completion, hosted dataset inspection, staging deployment ID or production verification is claimed.

`.env.local`, `.dev.vars*`, local databases, uploads, credentials, build output and temporary migration/evidence files are ignored. No other project was edited. No existing Canva design was overwritten, deleted or recreated during this work.
