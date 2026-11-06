# Build 001C — Canva publishing investigation and completion repair

Verified on 6 November 2026 in `C:\Projects\story-book-builder`. This build follows the final **Investigate false Canva publishing success** instruction. Revision publishing was held back while inspecting existing jobs; no `update_design` request was made or enabled.

## Finding: the two existing creations really succeeded

Read-only queries found two publishing records for **nervous birthday cake**, local book `b4163655-c0e2-4492-8ed5-60d8c3385dc8`. Neither was queued or failed. Both already contained an Autofill job ID, a generated design ID and an Open in Canva URL. The implementation submitted `create_from_design` on every publish and waited for the asynchronous job to return `success` with result type `create_design`, then fetched the resulting design metadata before saving success.

Live GET requests to Canva independently confirmed both records:

| Local job ID | Canva Autofill job ID | Live status / result | Generated design ID | Metadata lookup |
| --- | --- | --- | --- | --- |
| `a5c6b1a0-e89a-491e-b285-263af2b89d66` | `21c6b3e5-0802-409b-9002-16d1491d60a7` | `success` / `create_design` | `DAHaKl_mkXU` | HTTP 200, 33 pages |
| `04eddc8c-6ec1-4ecf-8089-87d7cd89ca90` | `97151117-98a5-4af4-9ff8-cb37d9b01ad6` | `success` / `create_design` | `DAHaK2Bh7W8` | HTTP 200, 33 pages |

Both designs have the title **nervous birthday cake**. Canva reports creation times of **18:57:25 UTC** and **19:49:36 UTC**, respectively. The first design's last-modified time is **19:53:20 UTC**, and the second's is **19:49:42 UTC**. A successful metadata response included an edit URL for each design.

`GET /users/me` returned user `oUZb6dhkfar_QxFBlGNT1Y`, team `oBZb6yUBXAtHSyL9kYqPkM`. Both generated designs and the master have exactly that owner user/team. This verifies the OAuth account and design ownership; it does **not** establish which account/team the owner's usual Canva browser is displaying. No additional profile scopes were requested, so no email or human-readable account name was obtained.

The protected master `DAHaJgBbCJ4`, **Automated Template Builder - Interior**, remains accessible with 33 pages. Its reported last modification is **15:12:50 UTC**, before both publishing jobs. The investigation sent only GET requests, used the existing unexpired access token without refresh, and performed no Canva writes. There is no evidence these jobs modified the master.

The observed unchanged earlier book is explained by the actual creation workflow: every submission makes a separate design. Local saves cannot update the earlier Canva document. The existing success states are corroborated by Canva; premature completion, missing result IDs and failed uploads do **not** explain these two records. The reported absence of a visible new design in the user's Canva interface remains an account/team/navigation question, rather than proof of failed generation. The prior UI made this harder to diagnose by hiding design IDs when a link was present and by presenting a generic completion message.

## Repair

- **Create New Canva Draft** explicitly creates a separate design; the form explains that existing Canva books are not updated.
- History shows **CREATED a separate design**, exact Canva job/design IDs, a direct **Open in Canva** link, and API result type/confirmation time when recorded. Older valid history works without rewriting it. Incomplete legacy success records are presented as needing recovery, without destroying the stored record.
- Stages are labelled **Preparing**, **Uploading**, **Generating**, **Complete** and **Failed**. Queuing a job explicitly says completion has not yet been confirmed.
- Poll responses must carry the requested job ID. Completion requires `status: success`, `result.type: create_design`, a nonempty design ID distinct from both the snapshot source and the protected master, matching design metadata, the expected page count and a valid Canva design URL.
- Malformed JSON, wrong jobs, missing IDs, wrong result types, provider failures and mismatched metadata cannot become new completed records. A confirmed design row and its completed job are saved in one SQLite transaction.
- New records persist operation, result type, job/design IDs, completion time and confirmation time. Safe machine-readable Canva error codes accompany actionable HTTP guidance; raw provider messages are withheld because they can echo private request data.
- **Check Canva status / refresh link** checks an existing known Autofill job with GETs only. It can recover a completed result after interrupted polling or resume bounded checks of that same pending job. It never repeats submission, uploads assets, requests an update, or creates another design. Failed refreshes leave previous completion records intact. Uncertain submission IDs require manual Canva inspection and are never replayed.
- Partial Autofill and advisory-first validation remain intact, including skipped incompatible populated fields and blank text, grouped DPI warnings, and explicit submission reports.

The [official job reference](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/get-design-autofill-job/) defines the asynchronous terminal states and the `create_design` result. It also describes design URLs as temporary. The [current-user reference](https://www.canva.dev/docs/apps/rest-apis/reference/users/users-me/) defines the account/team identity check. Recovery refreshes provider edit URLs rather than inventing replacement mappings or changing Canva content.

## Verification and preservation

- `npm.cmd run lint`: passed.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run test`: 48 tests passed, using isolated temporary databases and mocked Canva operations.
- `npm.cmd run test:browser`: 16 tests passed in installed Google Chrome with fresh contexts and extensions disabled. Tests cover creation, partial submissions, explicit CREATED results, status/link recovery, pending states, API errors, startup recovery, all six navigation sections and existing workspace operations.
- `npm.cmd run build`: passed with Next.js 16.4.5.
- New regression cases cover missing/malformed results, mismatched job IDs, missing design IDs, wrong result types, protected master results, wrong metadata IDs, invalid links, pending jobs, malformed JSON, failed/bounded polling, safe same-job recovery, inaccessible results, secret-safe provider errors, and incomplete legacy success records.
- Read-only Chrome inspection of the actual application at port 3000 loaded Dashboard, Book Library, Assets, Templates, Publishing and Settings. History displayed both generated IDs, two CREATED messages and two result links. No page exceptions or failed local requests were observed after allowing navigation loads to finish; six cancelled initial requests were normal development React cleanup. Screenshot: `.local/build001c-live-publishing.png` (ignored).
- Opening both actual saved result links in clean Chrome returned HTTP 200 and **Login to your Canva account**. API accessibility is confirmed; authenticated editor content was not visually inspected, and this build does not claim a live update or a new live creation.
- Before/after SHA-256 checks confirmed `.env.local`, every database row (including encrypted credentials, both jobs and both generated-design records), and all uploaded file contents were unchanged. SQLite `quick_check` returned `ok`. Data remains: 2 books, 66 pages, 44 assets, 2 jobs, 2 generated designs, 2 versions, 1 template, 1 credential and 1 migration. No database migration/reset was necessary.

## Changed files

| Files | Purpose |
| --- | --- |
| `src/lib/publishing.ts` | Strict identity/completion verification, atomic persistence, safe existing-job recovery, legacy summary safeguard |
| `src/lib/canva.ts` | Requested-job identity checks, malformed-response errors and safe provider codes |
| `src/lib/types.ts`, `src/lib/schema.ts` | Persist and retain operation/result/timestamp metadata through workspace loading |
| `src/app/api/[...path]/route.ts` | Owner/origin-protected existing-job status/link recovery endpoint |
| `src/components/publishing-view.tsx` | Explicit creation/stage labels, IDs, direct links and recoverable status checks |
| `tests/publishing-results.test.ts` | Completion and recovery regression coverage |
| `tests/browser/publishing-results.spec.ts` | Chrome history, pending and link-recovery coverage |
| `tests/core.test.ts`, `tests/partial-autofill.test.ts` | Include design identity in successful provider fixtures |
| `tests/browser/partial-autofill.spec.ts`, `tests/browser/workspace.spec.ts` | Verify the explicit creation action/stage labels |
| `package.json` | Include the new regression suite |
| `docs/BUILD001C.md` | Findings, exact live results, changes, verification and limitations |

## Next action for the owner

Open **Publishing History → Open in Canva** for each recorded design while signed into the intended Canva account/team. Use **Check Canva status / refresh link** if a temporary link expires. The app does not need another generation to recover either design.

There are two confirmed copies, so a future revision workflow must ask which generated design to use rather than guessing. Updating tagged fields and protecting manual Canva edits remain a separate workflow; no existing design is overwritten by this repair. Nothing was pushed or deployed.
