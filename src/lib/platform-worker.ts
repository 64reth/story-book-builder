import { env } from "cloudflare:workers";
import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import type { Backend } from "./storage";
const bindings = env as unknown as { DB: D1Database; ARTWORK: R2Bucket };
export async function backend(): Promise<Backend> {
  const db = bindings.DB;
  if (!db) throw new Error("D1 database binding is missing.");
  return {
    get: async <T>(sql: string, params: unknown[]) =>
      (await db
        .prepare(sql)
        .bind(...params)
        .first<T>()) ?? undefined,
    all: async <T>(sql: string, params: unknown[]) =>
      (
        await db
          .prepare(sql)
          .bind(...params)
          .all<T>()
      ).results,
    batch: async (commands) =>
      (
        await db.batch(commands.map((c) => db.prepare(c.sql).bind(...c.params)))
      ).map((r) => ({ changes: r.meta.changes })),
  };
}
export const artworkBucket = () => {
  if (!bindings.ARTWORK) throw new Error("R2 artwork binding is missing.");
  return bindings.ARTWORK;
};
