import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export interface Storage {
  get<T>(sql: string, ...params: (string | number | null)[]): T | undefined;
  all<T>(sql: string, ...params: (string | number | null)[]): T[];
  run(sql: string, ...params: (string | number | null)[]): { changes: number };
  transaction<T>(fn: () => T): T;
}
export const dataRoot = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.STORYBOOK_DATA_DIR ||
      path.join(process.cwd(), "data"),
  );
export const uploadRoot = () => path.join(dataRoot(), "uploads");
class SQLiteStorage implements Storage {
  private db: Database.Database;
  constructor() {
    mkdirSync(uploadRoot(), { recursive: true });
    this.db = new Database(path.join(dataRoot(), "storybook.sqlite"));
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
    );
    if (!this.db.prepare("SELECT id FROM migrations WHERE id = ?").get("001")) {
      this.db.transaction(() => {
        this.db.exec(
          readFileSync(
            path.join(process.cwd(), "migrations", "001-foundation.sql"),
            "utf8",
          ),
        );
        this.db
          .prepare("INSERT INTO migrations VALUES (?, ?)")
          .run("001", new Date().toISOString());
      })();
    }
  }
  get<T>(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  all<T>(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).all(...params) as T[];
  }
  run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  transaction<T>(fn: () => T) {
    return this.db.transaction(fn).immediate();
  }
}
const globalStore = globalThis as unknown as { storybookStorage?: Storage };
export function storage(): Storage {
  return (globalStore.storybookStorage ??= new SQLiteStorage());
}
