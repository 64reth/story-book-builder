# Story Book Builder

A private desktop publishing workspace for preparing story books and assembling editable Canva drafts. Local development uses SQLite and files; the Workers build uses D1 and R2.

## Local development

```powershell
npm.cmd ci
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm.cmd run dev
```

Open **http://127.0.0.1:3000**. Configure the existing `.env.local` with the Canva client ID/secret, a random session secret and the exact local OAuth callback. Keep it private. An existing workspace, database and uploads are retained.

## Workspace

Select a book or choose **New Book**. Drop illustrations into the batch area, review page assignments and apply. Explicit page numbers are matched first; unnumbered files use natural sorting. Folder selection supports batch artwork replacement without deleting old files used by versions or history.

Import TXT/Markdown or paste a manuscript. `Page N` and Markdown page headings target numbered pages. Explicit `---` separators and paragraph-based proposals are supported. Review the distribution before applying. Use the thumbnail grid and right-side inspector to edit pages; changes save automatically.

Use **Workspace tools** for the library, assets, templates, publishing history and Settings. Connect Canva in Settings. A stale/missing source dataset is inspected automatically; Templates also offers manual refresh.

- **Create New Canva Draft** uses the protected master `DAHaJgBbCJ4` and links the confirmed result as the active draft.
- Existing copies require explicit active-draft selection after account/book association checks. Neither `DAHaKl_mkXU` nor `DAHaK2Bh7W8` is silently selected.
- **Refine Canva Draft** reviews the exact changed fields before updating the chosen generated design. Only changed supported populated fields are submitted. Manual edits to those tagged elements may be overwritten; untouched fields and blank local fields are omitted.
- No-change plans do not create jobs. Success requires Canva's terminal `success`, the expected result type and verified design identity. History exposes the operation, IDs and direct Canva link. Known jobs can be checked/recovered without replaying submission.

Missing copy/art, print DPI, aspect ratios and layout estimates are advisories. Repeated issues are grouped; incompatible populated fields are transparently skipped. Omitted fields can leave template placeholders or existing content. Technical access, mapping/request impossibility and real API failures have recoverable errors. Keep the workspace open to drive confirmed uploads and bounded polling; returning resumes persisted progress.

Local page styling is a preview. Canva determines the finished layout. The master is never an update destination, and automated tests never modify a real Canva draft.

## Checks

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run test
npm.cmd run test:browser
npm.cmd run check:vinext
npm.cmd run build
npm.cmd run test:worker
```

Chrome coverage targets 1920×1080 and 2560×1440. `test:worker` exercises the compiled Worker in isolated workerd D1/R2 simulations, including owner authentication, storage and OAuth state compatibility. It does not claim hosted/live Canva verification.

`npm.cmd run build` now creates the staging-mode Workers build with vinext. `build:next` retains the legacy Next.js build check. `npm.cmd run dev` preserves localhost SQLite development. The Cloudflare CLI uses a project-local supported Node runtime; no system Node installation is changed.

## Cloudflare release

[Cloudflare status and runbook](docs/CLOUDFLARE.md) records the actual resources, migration evidence, supported commands and remaining release gates. A staging D1 database was created and its imported metadata verified. **R2 account enablement is still required; no hosted deployment success is claimed.**

Hosted access requires an owner login before any workspace/API data is returned. Secrets use Cloudflare secret bindings. `.env.local`, `.dev.vars*`, local databases/uploads, token state and temporary credential files are ignored. Hosted OAuth is authorised independently so localhost and hosted deployments do not compete over one rotating refresh token.

Use `deploy:staging` for the initial release. Production is gated until that exact Git commit passes actual hosted checks, production storage is migrated and the exact DNS hostname is available. No unrelated Worker, database, bucket or DNS record should be changed.

## Build notes

- [Build 001C investigation](docs/BUILD001C.md)
- [Build 001D refinement](docs/BUILD001D.md)
- [Build 002 desktop workspace](docs/BUILD002.md)
- [Cloudflare migration and release evidence](docs/CLOUDFLARE.md)
