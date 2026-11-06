import { workspaceResponseSchema } from "./schema";
import type { Workspace } from "./types";

export const WORKSPACE_TIMEOUT_MS = 15_000;

export async function loadWorkspace({
  signal,
  timeoutMs = WORKSPACE_TIMEOUT_MS,
}: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<Workspace> {
  const deadline = new AbortController();
  const requestSignal = signal
    ? AbortSignal.any([signal, deadline.signal])
    : deadline.signal;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    deadline.abort();
  }, timeoutMs);
  try {
    const response = await fetch("/api/workspace", {
      cache: "no-store",
      signal: requestSignal,
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (requestSignal.aborted) throw error;
      throw new Error(
        `Workspace returned an unreadable response (HTTP ${response.status}). Retry loading the workspace.`,
      );
    }
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        "error" in payload &&
        typeof payload.error === "string" &&
        payload.error.trim()
          ? payload.error
          : `Workspace request failed (HTTP ${response.status}).`;
      throw new Error(message);
    }
    const result = workspaceResponseSchema.safeParse(payload);
    if (!result.success)
      throw new Error(
        "Workspace returned invalid data. Retry loading the workspace; if this continues, check the local server logs.",
      );
    return result.data;
  } catch (error) {
    if (timedOut)
      throw new Error(
        `Workspace request timed out after ${Math.ceil(timeoutMs / 1000)} seconds. Check that the local server is running, then retry.`,
      );
    if (requestSignal.aborted) throw error;
    if (error instanceof TypeError)
      throw new Error(
        "Could not reach the local workspace. Check that the server is running, then retry.",
      );
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
