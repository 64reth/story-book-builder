# Build 001D — draft refinement

The publishing API now distinguishes `create_from_design` from `update_design`. Confirmed creation links its new design as the active draft. Existing copies require explicit selection and live user/team ownership plus dataset checks; the protected master `DAHaJgBbCJ4` is rejected as an update target.

Revision plans compare per-field manifests with the last successful submission to that specific design. Text uses exact submitted content; images use immutable storage filenames so replacing an asset under the same local ID still counts as a change. Legacy baselines are recovered from immutable job snapshots. Only compatible, populated, changed fields are sent. Blank fields remain omitted. No-change plans submit nothing.

The caller must review the exact field list, book revision and destination before submission. The server recomputes the plan and rejects stale approval. Completion must match the expected result type and, for updates, the exact target ID. No live Canva update or creation was performed during development.

The new desktop controls expose explicit target selection, affected-field review, Create New and Refine actions. Build 002 integrates these controls into the main workspace.

Verification at this milestone: 49 automated tests, TypeScript, ESLint and the Next.js production build passed. The fixture regression exercises explicit selection, master protection, no-change detection, changed-text-only partial update, review enforcement and matching asynchronous completion.

Vinext 1.4.4 / Cloudflare CLI tooling was installed for the subsequent migration. Initial `vinext check` reported 92% compatibility with no unsupported imports, with partial support for the old CSS loader and cache configuration. React was patched to 19.3.1 to satisfy vinext's peer dependency. A project-local Node 24.22 runtime satisfies the current Cloudflare CLI; system Node was not changed.
