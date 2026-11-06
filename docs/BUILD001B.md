# Build 001B — advisory-first drafts and partial Autofill

Verified on 6 November 2026 in `C:\Projects\story-book-builder`. Local application: **http://127.0.0.1:3000**.

## Root causes

Build 001 treated creative completeness as print-production eligibility. Both `validateBook` and `buildAutofill` required every page to have text/artwork, every mapping to be compatible and every illustration to meet the print DPI target. One wrong Canva type blocked the entire request, and per-page errors created a long blockers list. The publishing button depended on that all-or-nothing result.

The actual stored dataset identifies `PAGE_12_TEXT` as `image`. It cannot accept manuscript text. This repair skips that field; it does not rename labels, infer another field, coerce text to image data, invent copy or create empty assets.

## Canva documentation verification

The current [official Autofill guide](https://www.canva.dev/docs/apps/rest-apis/autofill-guide/) explains that not every field must be populated and omitted fields use template defaults (Generate an autofilled design, Step 2). It also describes `create_from_design` as creating a new design from a tagged source. The [Autofill endpoint reference](https://www.canva.dev/docs/apps/rest-apis/reference/autofills/create-design-autofill-job/) defines typed `data` values and the explicit source-design mode. Images must reference successfully uploaded Canva asset IDs.

Partial submission is supported. Skipping a field retains its source-template default, which may be placeholder text or old artwork. The app exposes exactly which fields are omitted and flags populated content that is not submitted. It never falls back to `update_design` or modifies source resources.

## Result for the actual stored book

Read-only inspection and Chrome verification used **nervous birthday cake** and its existing 33-page registered source. The result is:

- **Draft generation available**: 33 image fields and 26 text fields, 59 fields in total.
- Zero technical validation errors in the stored plan.
- Exactly seven skipped fields: `PAGE_12_TEXT` (populated manuscript content) and `PAGE_28_TEXT` through `PAGE_33_TEXT` (blank manuscript content).
- One mapping advisory: “Page 12 text could not be mapped because PAGE_12_TEXT is an image field. Correct the label in Canva to include this text automatically.”
- One manuscript advisory: “6 pages have no manuscript text (28–33).”
- One DPI advisory: “33 illustrations are below the 300 DPI print target (101–144 DPI). Review before final print export.”
- One grouped aspect-ratio advisory for eight illustrations, and one final layout/template-default review note: **five advisories total**.
- Page diagnostics are collapsed by default, with 33 detailed DPI entries and the mapping detail. The seven-field skip report is also expandable.

Chrome at the actual port 3000 confirmed an enabled **Generate Canva Draft** button and the compact report, with no page exceptions. This was a read-only check: no real publishing action or token refresh was initiated. Live account-specific partial generation remains for the owner to execute; contract tests exercised the full request/poll/success and rejection paths with mocked Canva responses.

## Changes

| Files                                                                                                        | Result                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/validation.ts`                                                                                      | Shared compatibility planner, safe omission, grouped advisories/ranges, optional diagnostics, request construction from compatible populated fields, and technical-only eligibility.                                                                                            |
| `src/lib/publishing.ts`                                                                                      | Recheck live source access; inspect local files; omit unavailable media without blocking remaining content; upload only planned images; persist the immutable field plan/report; verify source page count on completion. Genuine inspection/API failures stay technical errors. |
| `src/lib/types.ts`, `src/lib/schema.ts`                                                                      | Typed skipped-field records, planned text/image values and optional stored validation reports, retaining compatibility with existing jobs. No migration required.                                                                                                               |
| `src/lib/canva.ts`                                                                                           | Actionable HTTP 400 guidance, including manually finishing a copied draft if Canva refuses an account/design-specific request.                                                                                                                                                  |
| `src/components/publishing-view.tsx`                                                                         | Generation available for a valid partial plan; summary counts and availability; technical error/retry state; actual generation plan replaces the preview; persistent submission reports and populated-skip notices in active jobs/history.                                      |
| `src/components/ui.tsx`, `src/app/globals.css`                                                               | Compact advisory summary, collapsed diagnostics and exact skipped fields with explicit retained-placeholder guidance.                                                                                                                                                           |
| `src/components/templates-view.tsx`                                                                          | Mapping incompatibilities shown as advisories and included in validation counts.                                                                                                                                                                                                |
| `tests/partial-autofill.test.ts`, `tests/fixtures/partial-book.ts`, `tests/browser/partial-autofill.spec.ts` | Partial payload/aggregation/safety/API-error and Chrome availability/disclosure/retry regression coverage.                                                                                                                                                                      |
| `tests/core.test.ts`, `tests/browser/workspace.spec.ts`, `package.json`                                      | Update former blocking expectations and include partial regression tests in the standard suite.                                                                                                                                                                                 |
| `README.md`, `docs/BUILD001B.md`                                                                             | Current workflow, documentation evidence, verification and limits.                                                                                                                                                                                                              |

Creative incompleteness, low DPI, aspect ratio, overflow estimates, page-count differences, archive status and mapping issues are advisories. An entirely unpopulated/incompatible plan still cannot form a useful Autofill request and returns one actionable technical issue. A design with no accessible dataset or failed OAuth/API access also remains unavailable. No pages are silently added or removed; count differences are disclosed and a generated copy retains the source pages.

## Executed verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: **34 passed**. Regressions check Page 12 omission, preservation of all 59 valid fields, grouped DPI/text advisories, partial request availability, duplicate safety, missing artwork/overflow/aspect advisories, persisted submission reports, source immutability and genuine HTTP 400/403 failures.
- `npm run test:browser`: **14 passed**, including partial generation availability, collapsed diagnostics, explicit populated-content skips and technical error/retry behavior, plus existing startup/editor/asset/navigation tests. Browser publishing calls are mocked; databases are isolated.
- `npm run build`: passed.
- Actual Chrome verification at port 3000: enabled generation with the original book and dataset, matching the counts above; no exceptions.
- Before/after read-only preservation checks matched `.env.local`, every database row and uploaded file contents. SQLite integrity remains `ok`. Existing two books, 66 pages, 44 assets, encrypted Canva connection, source registration and migration were retained unchanged.

## Remaining limits

The app does not repair the Page 12 label. That text must be added manually to the generated copy, or the owner can correct the source label in Canva for future drafts. Omitted text/artwork may leave source placeholders or previous artwork in the copy. Print DPI/crop/overflow need final review in Canva. OAuth scopes, plan permissions, source access, API limits and remote failures can still prevent an operation; these are reported as recoverable technical failures. Unknown outcomes of non-idempotent requests remain protected against automatic replay.

No real Canva generation, source update, deployment or remote push was performed during verification. The local Build 001B commit hash is reported in the delivery message and available with `git log -1 --oneline`.
