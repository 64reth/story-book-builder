import type { Backend } from "./storage";
import type { R2Bucket } from "@cloudflare/workers-types";
export async function backend(): Promise<Backend> {
  const { localBackend } = await import("./storage-local");
  return localBackend();
}
export const artworkBucket = (): R2Bucket | null => null;
