import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { backend } from "@/lib/platform";
import { AppError } from "./errors";
type Param = string | number | null;
type Command = { sql: string; params: Param[] };
export interface Backend {
  get<T>(sql: string, params: Param[]): T | undefined | Promise<T | undefined>;
  all<T>(sql: string, params: Param[]): T[] | Promise<T[]>;
  batch(
    commands: Command[],
  ): { changes: number }[] | Promise<{ changes: number }[]>;
}
export interface Storage {
  get<T>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number }>;
  transaction<T>(fn: () => T | Promise<T>): Promise<T>;
}
export const dataRoot = () =>
  path.resolve(
    process.env.STORYBOOK_DATA_DIR || path.join(process.cwd(), "data"),
  );
export const uploadRoot = () => path.join(dataRoot(), "uploads");
class PortableStorage implements Storage {
  private backend = backend();
  private unit = new AsyncLocalStorage<{
    version: number;
    commands: Command[];
  }>();
  async get<T>(sql: string, ...params: Param[]) {
    return (await this.backend).get<T>(sql, params);
  }
  async all<T>(sql: string, ...params: Param[]) {
    return (await this.backend).all<T>(sql, params);
  }
  async run(sql: string, ...params: Param[]) {
    const unit = this.unit.getStore();
    if (unit) {
      unit.commands.push({ sql, params });
      return { changes: 1 };
    }
    return (
      await (
        await this.backend
      ).batch([
        {
          sql: "UPDATE app_revision SET expected=value, value=value+1 WHERE id=1",
          params: [],
        },
        { sql, params },
      ])
    )[1];
  }
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.unit.getStore()) return fn();
    const db = await this.backend;
    const version = (await db.get<{ value: number }>(
      "SELECT value FROM app_revision WHERE id=1",
      [],
    ))!.value;
    const unit = { version, commands: [] as Command[] };
    const result = await this.unit.run(unit, fn);
    if (unit.commands.length) {
      try {
        await db.batch([
          {
            sql: "UPDATE app_revision SET expected=?, value=value+1 WHERE id=1",
            params: [version],
          },
          ...unit.commands,
        ]);
      } catch (e) {
        if ((e as Error).message.includes("Workspace changed concurrently"))
          throw new AppError(
            "Workspace changed concurrently. Retry the operation.",
            409,
          );
        throw e;
      }
    }
    return result;
  }
}
const runtime = globalThis as unknown as { storybookAsyncStorage?: Storage };
export function storage(): Storage {
  return (runtime.storybookAsyncStorage ??= new PortableStorage());
}
