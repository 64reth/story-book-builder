import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AppError } from "./repository";
export function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32 || s.includes("replace_with"))
    throw new AppError(
      "Set SESSION_SECRET to at least 32 random characters in .env.local.",
      503,
    );
  return s;
}
const key = () => createHash("sha256").update(secret()).digest();
export function encrypt(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64url");
}
export function decrypt<T>(value: string): T {
  const b = Buffer.from(value, "base64url"),
    cipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  cipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([cipher.update(b.subarray(28)), cipher.final()]).toString(
      "utf8",
    ),
  );
}
export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function makeOwner() {
  const payload = `${randomBytes(32).toString("base64url")}.${Date.now() + 7 * 86400000}`;
  return `${payload}.${createHmac("sha256", secret()).update(payload).digest("base64url")}`;
}
export function validOwner(cookie: string) {
  const [id, expiry, sig] = cookie.split(".");
  return (
    !!id &&
    Number(expiry) > Date.now() &&
    safeEqual(
      sig || "",
      createHmac("sha256", secret())
        .update(`${id}.${expiry}`)
        .digest("base64url"),
    )
  );
}
export function cookieValue(request: Request, name = "sb_owner") {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export function localBoundary(request: Request, mutation = false) {
  const url = new URL(request.url),
    host = request.headers.get("host") || url.host;
  const app = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(app.hostname) ||
    host !== app.host
  )
    throw new AppError(
      `Open the workspace at ${app.origin}. Remote access is disabled in single-owner mode.`,
      403,
    );
  if (mutation && request.headers.get("origin") !== app.origin)
    throw new AppError(
      "Request origin did not match the local workspace.",
      403,
    );
  if (request.headers.get("sec-fetch-site") === "cross-site" && mutation)
    throw new AppError("Cross-site request blocked.", 403);
}
export function requireOwner(request: Request, mutation = false) {
  localBoundary(request, mutation);
  const owner = cookieValue(request);
  if (!validOwner(owner))
    throw new AppError("Workspace session expired. Reload the page.", 401);
  return owner;
}
export function ownerCookie(value: string) {
  return `sb_owner=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${process.env.APP_URL?.startsWith("https:") ? "; Secure" : ""}`;
}
export function pkce() {
  const verifier = randomBytes(48).toString("base64url");
  return {
    verifier,
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    state: randomBytes(32).toString("base64url"),
  };
}
