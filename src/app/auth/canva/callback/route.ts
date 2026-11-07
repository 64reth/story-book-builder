import { consumeOAuthState, finishOAuth } from "@/lib/canva";
import { AppError } from "@/lib/repository";
import { requireOwner } from "@/lib/security";
export async function GET(request: Request) {
  const destination = new URL(
    "/settings",
    process.env.APP_URL || "http://127.0.0.1:3000",
  );
  try {
    const owner = requireOwner(request),
      params = new URL(request.url).searchParams;
    const verifier = await consumeOAuthState(params.get("state") || "", owner);
    if (params.has("error"))
      throw new AppError(
        "Canva authorization was declined. You can connect again when ready.",
      );
    await finishOAuth(params.get("code") || "", verifier);
    destination.searchParams.set("connected", "1");
  } catch (e) {
    destination.searchParams.set(
      "error",
      e instanceof AppError
        ? e.message
        : "Canva connection failed. Check the configuration and try again.",
    );
  }
  return Response.redirect(destination, 303);
}
