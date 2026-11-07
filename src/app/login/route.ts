import { storage } from "@/lib/storage";
import {
  localBoundary,
  makeOwner,
  ownerCookie,
  safeEqual,
  hash,
} from "@/lib/security";
const headers = {
  "Cache-Control": "no-store",
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
};
const page = (message = "") =>
  new Response(
    `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Story Book Builder · Owner sign-in</title><style>body{font:16px Arial;background:#f4f6f1;color:#263c2e;display:grid;place-items:center;min-height:95vh}form{background:white;padding:40px;border-radius:16px;width:340px}input,button{box-sizing:border-box;padding:12px;width:100%;margin-top:14px}button{background:#41694f;color:white;border:0;border-radius:6px}p{line-height:1.5}</style><form method="post"><h1>Story Book Builder</h1><p>Owner sign-in</p><label>Password<input type="password" name="password" autocomplete="current-password" required maxlength="256"></label><button>Sign in</button><p role="alert">${message}</p></form></html>`,
    { headers },
  );
export async function GET() {
  return page();
}
export async function POST(request: Request) {
  try {
    localBoundary(request, true);
    if (!process.env.OWNER_PASSWORD_HASH)
      return new Response("Owner authentication is not configured.", {
        status: 503,
        headers,
      });
    const ip = request.headers.get("CF-Connecting-IP") ?? "local",
      key = `login-rate:${hash(ip)}`,
      window = Math.floor(Date.now() / 600000);
    const attempt = await storage().transaction(async () => {
      const row = await storage().get<{ document: string }>(
        "SELECT document FROM settings WHERE id=?",
        key,
      );
      const prior = row ? JSON.parse(row.document) : { window, count: 0 };
      const count = prior.window === window ? prior.count + 1 : 1;
      await storage().run(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
        key,
        JSON.stringify({ window, count }),
      );
      return count;
    });
    if (attempt > 10)
      return new Response(
        "Too many sign-in attempts. Try again in ten minutes.",
        { status: 429, headers },
      );
    if (Number(request.headers.get("content-length") ?? 0) > 2048)
      return new Response("Request too large", { status: 413, headers });
    const password = String((await request.formData()).get("password") ?? "");
    const [salt, expected] = process.env.OWNER_PASSWORD_HASH.split(":");
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"],
    );
    const derived = Buffer.from(
      await crypto.subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: Buffer.from(salt, "hex"),
          iterations: 100000,
          hash: "SHA-256",
        },
        material,
        256,
      ),
    ).toString("hex");
    if (!safeEqual(derived, expected))
      return page("Sign-in failed. Check your owner password.");
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": ownerCookie(makeOwner()),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Sign-in could not be completed. Retry.", {
      status: 403,
      headers,
    });
  }
}
