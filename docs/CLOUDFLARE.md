# Cloudflare migration and release evidence

## Live status — 7 November 2026

Staging is deployed at https://story-book-builder-staging.garetha81.workers.dev and production at https://storybookbuilder.allencreativetechnologies.uk. Both live URLs were checked after deployment. Owner login, all six desktop views, D1 autosave/reload, private artwork upload/read/delete, imported artwork integrity, and persistence across a subsequent deployment have passed in both environments. Staging hosted Canva OAuth has passed. Production is configured for Canva but still awaits independent owner consent; no completed production OAuth is claimed yet.

The deployed application source is commit `dbabc886cb43e70eab0a02efadbc6c339e158e01`. This later documentation update does not change the deployed code.

| Environment | Latest verified Worker version |
| --- | --- |
| Staging | `5ff475e2-eea7-4114-9f7c-f3549a0b061d` |
| Production | `0b98a9e0-4d25-43cc-afc8-2eee6d9b98b5` |

Wrangler `whoami` verified account `203bf3287fc4eb1260ec344a3e0f5071`. R2 account activation is complete. `story-book-builder-assets` was absent, created, then verified by bucket list. Wrangler confirms public r2.dev access is **disabled** and no public bucket custom domain exists.

| Resource | Staging | Production |
| --- | --- | --- |
| Worker | `story-book-builder-staging` | `story-book-builder` |
| D1 name | `story-book-builder-staging` | `story-book-builder-production` |
| D1 ID | `67d9f434-bc57-4df3-9921-c7b0cd49bbd4` | `d06bc5f4-f30e-4714-9eb9-c01c8fb9b2fd` |
| Private R2 bucket | `story-book-builder-assets` | `story-book-builder-assets` |
| Artwork binding | `ASSETS` | `ASSETS` |
| Object prefix | Root | `production/` |
| Static website binding | `STATIC_ASSETS` | `STATIC_ASSETS` |
| Application origin | `https://story-book-builder-staging.garetha81.workers.dev` | `https://storybookbuilder.allencreativetechnologies.uk` |

Production has a separate D1 database, artwork prefix, owner password and session encryption key. Deleting an unreferenced staging upload cannot delete production artwork. Only Story Book Builder resources and the exact requested production hostname are in scope; unrelated resources were not modified.

## Implementation and findings

`cloudflare.config.ts` remains the authoritative typed vinext deployment configuration. `wrangler.jsonc` provides matching staging bindings for the installed Wrangler CLI, using the compiled Worker and static directory. Pass `--config wrangler.jsonc` explicitly: an ignored legacy `.wrangler/deploy/config.json` still points at the old output path. No dependency or application architecture rebuild was needed.

vinext conventionally uses `ASSETS` for static files. The requested private R2 binding now owns that name, and `src/worker.ts` passes `STATIC_ASSETS` to the framework under its expected static-service name. The actual `cloudflare:workers.env.ASSETS` stays an R2 bucket for server-only artwork operations. Neither a static asset directory nor a public R2 endpoint contains uploaded artwork.

Artwork upload, retrieval and deletion use owner-authenticated `/api/assets` routes. Writes enforce the exact application Origin. The storage adapter uses R2 `put/get/head/delete`, preserving immutable filenames, MIME types and existing asset/book/page references. Deletion refuses assets referenced by books, saved versions or publishing snapshots. Local SQLite/uploads remain the localhost adapter, with no Worker filesystem fallback.

Live verification initially detected incomplete chunked image responses even though R2 downloads were intact. The former API buffered complete objects into several copies. Retrieval now streams R2 bodies and enforces their known length at the outer Worker boundary. Framework response wrapping loses known-length stream metadata, so a final Cloudflare `FixedLengthStream` restores HTTP framing and rejects short/long transfers. Live HTTP now advertises the correct Content-Length. Cache headers are private and prohibit transformation. Chrome subsequently verified all 44 original image hashes. The precise upstream cause of the initial connection truncations was not independently established; the bucket data itself was never corrupt. See the official [Response framing documentation](https://developers.cloudflare.com/workers/runtime-apis/response/) and [FixedLengthStream documentation](https://developers.cloudflare.com/workers/runtime-apis/streams/transformstream/).

The first deployment correctly refused missing required secrets. `scripts/deploy-staging.mjs` now supplies the ignored secret file through supported `cf deploy --secrets-file`, provisioning secrets atomically with the initial Worker version. No secret values are logged or committed. Production retains the release gate and uses the same first-deployment mechanism.

## Data preservation and migration

The original SQLite database, all rows, uploaded files, `.env.local` and local encrypted OAuth credentials remain unchanged. A consistent ignored backup is `.local/pre-cloudflare.sqlite`. Preservation verification checks original row content, environment bytes and upload hashes, plus SQLite `quick_check`.

Each hosted database imports 2 books, 66 pages, 44 asset records, 1 template, 2 jobs, 2 generated-design records, 2 versions and the original settings record. `scripts/cloudflare-data.mjs verify` compares every imported metadata row, not just counts. Only additive schema migrations run; databases are never reset. Host sign-in and testing subsequently add their own settings/test records.

All 44 original artwork files are copied without deleting local files. `verify-artwork` downloads every object and compares byte length and SHA-256. Filenames stay unchanged in application records; production object keys have the `production/` isolation prefix. Ignored manifests and verification evidence are under `.local/`.

OAuth credentials and one-time OAuth state are not cloned between environments, avoiding competing rotating refresh tokens. Hosted Canva consent is independent; localhost configuration and callback remain intact. All three exact redirects are registered. Owner passwords are stored only in ignored `.local/staging-owner-access.json` and `.local/production-owner-access.json`; server password hashes and secrets use Cloudflare secret bindings.

## Actual Canva checks

The owner completed staging consent. The deployed application retrieved protected master `DAHaJgBbCJ4`: 33 pages, 66 dataset fields, and `PAGE_12_TEXT` still has type `image`. It was inspected only; no update, new design or template mutation was submitted.

The populated book validates with no technical errors. Its partial plan contains 26 text fields and 33 image fields, skips incompatible Page 12 text explicitly, and groups missing manuscript/DPI advisories. The other existing book has no selected template and correctly reports that recoverable technical prerequisite.

Rechecking existing recorded jobs confirmed remote job `97151117-98a5-4af4-9ff8-cb37d9b01ad6` succeeded with result type `create_design`, generated design `DAHaK2Bh7W8`, accessible design metadata and a direct Canva edit URL. The other historical job status request returns Canva `404 (not_found)`; no replay or replacement submission was attempted. Original local history remains untouched. Existing copies still require explicit selection; no target was guessed. No live Canva update is claimed.

## Verification

- ESLint and TypeScript pass.
- 54 automated tests pass, including safe partial Autofill, changed-only refinement, protected master, no-change behavior, job failures and atomic D1-compatible transactions.
- 19 isolated desktop Chrome tests pass, covering imports, replacements, autosave, refinement review and navigation at 1920×1080 and 2560×1440.
- Workers production build passes. Upstream source-map/icon optimization warnings are non-fatal.
- Compiled workerd tests pass: owner auth, D1 persistence, private R2 upload/read/delete, multi-megabyte byte integrity, static/R2 binding separation, Origin rejection and OAuth PKCE/encryption compatibility.
- Live staging and production Chrome pass six desktop views with zero browser exceptions, owner login, all 44 imported artwork SHA-256/MIME checks, private upload/read/delete, UI autosave and full reload. Each environment has a separately created archived test book; imported books are not edited.
- Each environment was redeployed after creating its test book and artwork. The saved manuscript, asset association and image hash survived that deployment; `verify-hosted.mjs --resume` checked the original saved receipt.
- Real hosted OAuth, source dataset and existing job recovery were checked without publishing.
- The final local preservation check passes: every original database row, environment byte and upload hash remains unchanged. Source and compiled-build scans find no actual secret values or private data paths committed in history.

## Commands and release gates

```powershell
npx.cmd --no-install wrangler whoami
npx.cmd --no-install wrangler r2 bucket list --config wrangler.jsonc
npx.cmd --no-install wrangler r2 bucket dev-url get story-book-builder-assets --config wrangler.jsonc
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:browser
npm.cmd run build
npm.cmd run test:worker
node_modules/node/bin/node.exe scripts/verify-hosted.mjs
node_modules/node/bin/node.exe scripts/verify-hosted-canva.mjs
npm.cmd run deploy:staging
```

Migration actions are `prepare`, `schema`, `metadata`, `verify`, `artwork`, `verify-artwork`, and `secrets`. Append `--production` only for the explicitly configured production resources. Initial secret files are ignored and existing values are retained.

Production release requires a clean committed tree, the same Git HEAD verified on hosted staging, all recorded hosted checks, verified dedicated production D1/R2 migration and an available exact DNS name. `scripts/release-production.mjs` checks these gates and validates compiled production resource identities before deploying. No bypass flag is provided. Production OAuth must then be authorised independently and verified on its live URL.

## Remaining owner action

Open https://storybookbuilder.allencreativetechnologies.uk/login and use the password in ignored `.local/production-owner-access.json`. In Settings, choose **Connect Canva**, approve consent, and return through the production callback. Then run `scripts/verify-hosted-canva.mjs --production` to verify the live dataset and historical job recovery there. Do not copy the staging or localhost rotating token into production.

The old Canva job returning 404 remains a historical limitation. No design was deleted, overwritten or regenerated during verification. Choose an existing generated draft explicitly before reviewing any refinement; no successful live `update_design` operation has been claimed.

## Changed files

- Bindings and Worker boundary: `cloudflare.config.ts`, `wrangler.jsonc`, `src/worker.ts`, `src/lib/platform-worker.ts`.
- Artwork streaming and authenticated API: `src/lib/artwork-store.ts`, `src/lib/assets.ts`, `src/app/api/[...path]/route.ts`.
- Existing Settings copy: `src/components/settings-view.tsx` now describes both creation and reviewed refinement.
- Migration/release: `scripts/cloudflare-data.mjs`, `scripts/deploy-staging.mjs`, `scripts/release-production.mjs`, and the `deploy:staging` package script.
- Verification: `scripts/test-worker.mjs`, `scripts/verify-hosted.mjs`, `scripts/verify-hosted-canva.mjs`, `scripts/check-release-secrets.mjs`.
- Documentation: `README.md` and this report. No other project was edited.
