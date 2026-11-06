# Build 001A — startup loading repair

Verified on 6 November 2026 against the actual application at **http://127.0.0.1:3000**. No application architecture, SQLite migration, environment value, OAuth configuration or Canva resource was changed.

## Exact cause and reproduction

The running Next.js development instance had been started with its default `localhost` hostname metadata. The application and OAuth callback use `127.0.0.1`. Next.js 16.4.5 rejected the browser's `127.0.0.1` origin for `/_next/hmr` because this hostname was not in `allowedDevOrigins`.

A fresh, temporary Chrome profile with extensions disabled reproduced the actual failure:

- The document, stylesheet and JavaScript requests returned HTTP 200.
- The page retained its server-rendered navigation shell and “Opening your workspace…” message.
- **No `/api/workspace` request was made.** There was no pending application API request or application exception.
- Repeated `ws://127.0.0.1:3000/_next/hmr?id=…` handshakes failed with `net::ERR_INVALID_HTTP_RESPONSE`.
- The development terminal log explicitly reported: `Blocked cross-origin request to Next.js dev resource /_next/hmr from "127.0.0.1"` and recommended `allowedDevOrigins: ['127.0.0.1']`.

This WebSocket failure was causally related to startup, rather than incidental HMR noise. In the installed Next.js version, `client/app-index.js` creates a React development debug channel, passes it to the initial Flight decoder and awaits `initialServerResponse` before `hydrateRoot`. `client/dev/debug-channel.js` creates the readable stream; `hot-reloader/app/hot-reloader-app.js` delivers and closes its debug chunks through HMR. Blocking that channel left hydration pending, so the workspace's initial `useEffect` never ran.

As a controlled comparison, opening `http://localhost:3000` on the same server established HMR and made `/api/workspace` requests. The app then displayed its expected API hostname rejection, because `APP_URL` correctly requires `127.0.0.1`. This confirmed that application effects could start when the development stream was available. API hostname/origin protections remain unchanged.

Adding only the loopback development-origin entry, before changing the loading code, made the actual dashboard load: HMR frames arrived, `/api/workspace` returned 200 and the dashboard rendered with Canva disconnected. No extension-related warnings occurred in the clean profile.

## Startup path audit

- The root layout contains no application provider or initialization promise. Its page wraps the client workspace in Suspense.
- The initial workspace effect depends on a stable notification callback; it was not continuously restarting. React Strict Mode may start and cancel its probe request once.
- The API awaits route parameters, checks the local host, runs idempotent initialization, validates/signs the owner cookie, reads assets, awaits local directory-size traversal, then reads books/pages, templates, jobs, preferences and connection metadata.
- SQLite uses synchronous statements, transactional migrations, WAL and a 5-second busy timeout. Migration 001 and its bookkeeping row were present. `PRAGMA quick_check` returned `ok`.
- A direct `/api/workspace` request returned HTTP 200 in approximately **61 ms**, with all eight expected response keys. No database lock, schema mismatch, missing environment variable or unresolved file operation caused this incident.
- Connection status reads local credential metadata. Startup performs no Canva authorization, token refresh or remote API call.

## Repair files

| File                             | Change                                                                                                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `next.config.ts`                 | Explicitly allow `127.0.0.1` for development resources; no wildcard or API security change.                                                                          |
| `src/lib/workspace-client.ts`    | Shared bounded workspace read: 15-second deadline includes headers/body, abort support, actionable errors and response validation.                                   |
| `src/lib/schema.ts`              | Runtime schema for the existing workspace response.                                                                                                                  |
| `src/components/workspace.tsx`   | Use bounded reads for initialization/refresh, cancel obsolete effect requests, ignore stale responses, show an alert and retry through the same initialization path. |
| `playwright.config.ts`           | Use an extension-free Chrome profile and the original default-hostname/loopback mismatch on an isolated server.                                                      |
| `tests/browser/startup.spec.ts`  | Seven browser regressions for hydration, HTTP/network/JSON/schema errors, deadline/retry and empty-library navigation.                                               |
| `tests/workspace-client.test.ts` | Seven unit tests for empty/disconnected data, errors, retry, pending fetch/body deadlines and lifecycle cancellation.                                                |
| `package.json`                   | Include the startup unit tests in `npm test`.                                                                                                                        |
| `README.md`, `docs/BUILD001A.md` | Startup troubleshooting and investigation evidence.                                                                                                                  |

## Verification and preservation

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: **26 passed** (19 existing plus 7 startup tests).
- `npm run test:browser`: **11 passed** (4 existing workflows plus 7 startup regressions), using a fresh SQLite directory and no Canva client secret/account connection.
- `npm run build`: passed.
- Actual clean-Chrome navigation at port 3000 verified **Dashboard, Book Library, Asset Library, Templates, Publishing and Settings**, with workspace HTTP 200 responses, no page/WebSocket errors and Canva disconnected.
- The actual database was opened read-only for integrity and preservation checks. Before/after hashes of every row in all 11 entity/migration tables, all uploaded files and `.env.local` matched. The original book, 33 pages, migration row and pending OAuth states were retained. No database reset, deletion, token exchange or OAuth mutation occurred.

The 15-second deadline protects workspace requests after hydration. The actual pre-hydration failure is repaired by the development-origin configuration; it is not concealed with a timeout or disabled HMR. An already-open stuck tab should be reloaded once to obtain a fresh document/debug stream.

No deployment or remote push was performed. The local repair commit hash is provided in the delivery message and through `git log -1 --oneline`.
