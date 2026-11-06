import { AppError, get, now, put } from "./repository";
import { decrypt, encrypt, hash, pkce } from "./security";
import { storage } from "./storage";
import { defaultMapping } from "./validation";
import type { Dataset, RemoteJob, Template } from "./types";

const API = "https://api.canva.com/rest/v1";
export const SCOPES = [
  "asset:read",
  "asset:write",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
];
type Tokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
const credential = () =>
  storage().get<{ encrypted: string }>(
    "SELECT encrypted FROM credentials WHERE id='canva'",
  );
export function connection() {
  const missing = [
    "CANVA_CLIENT_ID",
    "CANVA_CLIENT_SECRET",
    "CANVA_REDIRECT_URI",
    "SESSION_SECRET",
  ].filter((k) => !process.env[k]);
  return {
    connected: !!credential(),
    configured: missing.length === 0,
    missing,
  };
}
function config() {
  const status = connection();
  if (!status.configured)
    throw new AppError(
      `Configure ${status.missing.join(", ")} in .env.local, then restart the application.`,
      503,
    );
  const redirect = process.env.CANVA_REDIRECT_URI!;
  if (
    redirect !==
    `${process.env.APP_URL || "http://127.0.0.1:3000"}/auth/canva/callback`
  )
    throw new AppError(
      "CANVA_REDIRECT_URI must match APP_URL followed by /auth/canva/callback.",
      503,
    );
  return {
    clientId: process.env.CANVA_CLIENT_ID!,
    clientSecret: process.env.CANVA_CLIENT_SECRET!,
    redirect,
  };
}
function basic() {
  const c = config();
  return (
    "Basic " + Buffer.from(`${c.clientId}:${c.clientSecret}`).toString("base64")
  );
}
export function storeTokens(value: {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}) {
  if (
    !value.access_token ||
    !value.refresh_token ||
    !Number.isFinite(value.expires_in)
  )
    throw new AppError(
      "Canva returned an incomplete token response. Reconnect Canva.",
      502,
    );
  storage().run(
    "INSERT INTO credentials VALUES ('canva', ?) ON CONFLICT(id) DO UPDATE SET encrypted=excluded.encrypted",
    encrypt({
      access_token: value.access_token,
      refresh_token: value.refresh_token,
      expires_at: Date.now() + value.expires_in * 1000,
    }),
  );
}
async function tokenRequest(body: URLSearchParams) {
  let response: Response;
  try {
    response = await fetch(`${API}/oauth/token`, {
      method: "POST",
      headers: {
        Authorization: basic(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new AppError(
      "Canva token request could not be completed. Check your connection and reconnect Canva.",
      502,
    );
  }
  if (!response.ok)
    throw new AppError(
      `Canva token exchange failed (${response.status}). Check the client secret and redirect URI, then reconnect.`,
      502,
    );
  storeTokens(await response.json());
}
const runtime = globalThis as unknown as { canvaRefresh?: Promise<void> };
export async function accessToken() {
  const row = credential();
  if (!row) throw new AppError("Connect Canva in Settings.", 401);
  let tokens = decrypt<Tokens>(row.encrypted);
  if (tokens.expires_at < Date.now() + 60000) {
    // Single-process SQLite deployment; coalesce refreshes to protect rotation.
    if (!runtime.canvaRefresh) {
      runtime.canvaRefresh = tokenRequest(
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: tokens.refresh_token,
        }),
      ).finally(() => {
        runtime.canvaRefresh = undefined;
      });
    }
    await runtime.canvaRefresh;
    const current = credential();
    if (!current) throw new AppError("Canva was disconnected.", 401);
    tokens = decrypt<Tokens>(current.encrypted);
  }
  return tokens.access_token;
}
export function startOAuth(owner: string) {
  const c = config(),
    p = pkce();
  storage().run("DELETE FROM oauth_states WHERE expires_at < ?", Date.now());
  storage().run("DELETE FROM oauth_states WHERE owner_hash=?", hash(owner));
  storage().run(
    "INSERT INTO oauth_states VALUES (?, ?, ?, ?)",
    hash(p.state),
    hash(owner),
    encrypt({ verifier: p.verifier }),
    Date.now() + 600000,
  );
  const url = new URL("https://www.canva.com/api/oauth/authorize");
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: c.clientId,
    redirect_uri: c.redirect,
    scope: SCOPES.join(" "),
    code_challenge: p.challenge,
    code_challenge_method: "S256",
    state: p.state,
  }).toString();
  return url.toString();
}
export function consumeOAuthState(state: string, owner: string) {
  return storage().transaction(() => {
    const row = storage().get<{
      owner_hash: string;
      encrypted: string;
      expires_at: number;
    }>("SELECT * FROM oauth_states WHERE id=?", hash(state));
    if (
      !state ||
      !row ||
      row.owner_hash !== hash(owner) ||
      row.expires_at < Date.now()
    )
      throw new AppError(
        "OAuth state is invalid or expired. Start Connect Canva again.",
        403,
      );
    storage().run("DELETE FROM oauth_states WHERE id=?", hash(state));
    return decrypt<{ verifier: string }>(row.encrypted).verifier;
  });
}
export async function finishOAuth(code: string, verifier: string) {
  if (!code || code.length > 4096)
    throw new AppError("Canva did not return an authorization code.");
  await tokenRequest(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: config().redirect,
    }),
  );
}
export async function disconnect() {
  const row = credential();
  if (runtime.canvaRefresh) await runtime.canvaRefresh;
  if (row) {
    const current = credential();
    const tokens = decrypt<Tokens>((current ?? row).encrypted);
    let response: Response;
    try {
      response = await fetch(`${API}/oauth/revoke`, {
        method: "POST",
        headers: {
          Authorization: basic(),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token: tokens.refresh_token }),
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new AppError(
        "Canva could not be reached to revoke consent. Try disconnecting again.",
        502,
      );
    }
    if (!response.ok)
      throw new AppError(
        `Canva could not revoke consent (${response.status}). Retry disconnect.`,
        502,
      );
    storage().run("DELETE FROM credentials WHERE id='canva'");
    storage().run("DELETE FROM oauth_states");
  }
}
export class CanvaError extends AppError {
  constructor(
    message: string,
    status: number,
    public retryAfter = 0,
  ) {
    super(message, status);
  }
}
export async function canva<T>(
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(API + endpoint, {
      ...init,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        ...init.headers,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new CanvaError(
      "Canva request timed out or the network is unavailable. Check publishing history before starting another generation.",
      502,
    );
  }
  if (!response.ok) {
    const guidance =
      response.status === 401
        ? "Reconnect Canva in Settings."
        : response.status === 403
          ? "Check the app scopes, Canva plan and access to this design."
          : response.status === 404
            ? "Check the design or job ID and account access."
            : response.status === 429
              ? "Canva rate limit reached. Wait before retrying."
              : "Check Canva service availability and retry.";
    // Do not relay provider bodies: they may echo request data or credentials.
    throw new CanvaError(
      `Canva returned ${response.status}. ${guidance}`,
      response.status === 401 ? 401 : 502,
      Number(response.headers.get("retry-after") || 0),
    );
  }
  return response.json() as Promise<T>;
}
export async function inspectTemplate(id: string) {
  const template = get<Template>("templates", id);
  if (!template) throw new AppError("Template not found.", 404);
  try {
    const [datasetResponse, meta] = await Promise.all([
      canva<{ dataset: Dataset }>(`/designs/${encodeURIComponent(id)}/dataset`),
      canva<{ design: { title?: string; page_count?: number } }>(
        `/designs/${encodeURIComponent(id)}`,
      ),
    ]);
    if (
      !datasetResponse.dataset ||
      Object.values(datasetResponse.dataset).some(
        (v) => !v || typeof v.type !== "string",
      )
    )
      throw new AppError("Canva returned an unrecognized dataset.", 502);
    const count = meta.design.page_count ?? null;
    if (
      count !== null &&
      (!Number.isInteger(count) || count < 1 || count > 100)
    )
      throw new AppError("Canva template must have between 1 and 100 pages.");
    const updated: Template = {
      ...template,
      name: meta.design.title || template.name,
      dataset: datasetResponse.dataset,
      pageCount: count,
      mapping: template.mapping.length
        ? template.mapping
        : defaultMapping(count ?? 0),
      checkedAt: now(),
      error: null,
    };
    put("templates", id, updated);
    return updated;
  } catch (e) {
    put("templates", id, {
      ...template,
      error:
        e instanceof AppError ? e.message : "Could not inspect Canva template.",
    });
    throw e;
  }
}
export const remoteJob = (endpoint: string, init?: RequestInit) =>
  canva<{ job: RemoteJob }>(endpoint, init).then((r) => {
    if (
      !r.job?.id ||
      !["in_progress", "success", "failed"].includes(r.job.status)
    )
      throw new AppError("Canva returned an unrecognized job response.", 502);
    return r.job;
  });
