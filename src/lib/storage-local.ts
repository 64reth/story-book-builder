import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Backend } from "./storage";
export function localBackend(): Backend {
  const root = path.resolve(
    process.env.STORYBOOK_DATA_DIR || path.join(process.cwd(), "data"),
  );
  mkdirSync(path.join(root, "uploads"), { recursive: true });
  const db = new Database(path.join(root, "storybook.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  for (const [id, file] of [
    ["001", "001-foundation.sql"],
    ["002", "002-atomic-storage.sql"],
    ["003", "003-canva-refresh.sql"],
  ]) {
    if (!db.prepare("SELECT id FROM migrations WHERE id=?").get(id))
      db.transaction(() => {
        db.exec(
          readFileSync(path.join(process.cwd(), "migrations", file), "utf8"),
        );
        db.prepare("INSERT INTO migrations VALUES (?,?)").run(
          id,
          new Date().toISOString(),
        );
      })();
  }
  return {
    get: <T>(sql: string, params: unknown[]) =>
      db.prepare(sql).get(...params) as T | undefined,
    all: <T>(sql: string, params: unknown[]) =>
      db.prepare(sql).all(...params) as T[],
    batch: (commands) =>
      db.transaction(() =>
        commands.map((c) => ({
          changes: db.prepare(c.sql).run(...c.params).changes,
        })),
      )(),
  };
}
