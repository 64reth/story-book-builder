import { randomUUID } from "node:crypto";
import { storage } from "./storage";
import { defaultMapping } from "./validation";
import type {
  Asset,
  Book,
  Page,
  Preferences,
  PublishJob,
  Template,
} from "./types";
import { AppError } from "./errors";
export { AppError } from "./errors";
type Table = "assets" | "templates" | "publishing_jobs" | "settings";
export const now = () => new Date().toISOString();
export async function list<T>(table: Table): Promise<T[]> {
  return (
    await storage().all<{
      document: string;
    }>(`SELECT document FROM ${table}`)
  ).map((r) => JSON.parse(r.document));
}
export async function get<T>(table: Table, id: string): Promise<T | undefined> {
  const row = await storage().get<{
    document: string;
  }>(`SELECT document FROM ${table} WHERE id=?`, id);
  return row ? JSON.parse(row.document) : undefined;
}
export async function put(
  table: Exclude<Table, "publishing_jobs">,
  id: string,
  doc: unknown,
) {
  await storage().run(
    `INSERT INTO ${table} (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document`,
    id,
    JSON.stringify(doc),
  );
}
export const defaults: Preferences = {
  width: 8.625,
  height: 8.7,
  margin: 0.375,
  font: "Lilita One",
  dpi: 300,
  exportFormat: "pdf_print",
  theme: "light",
};
export async function preferences() {
  return (await get<Preferences>("settings", "preferences")) ?? defaults;
}
export function blankPage(): Page {
  return {
    id: randomUUID(),
    text: "",
    assetId: null,
    placement: "cover",
    bubbleColor: "#f6dfcf",
    bubbleOpacity: 0.55,
    textPosition: "bottom",
    fontSize: 30,
    textColor: "#302e36",
  };
}
export async function books(): Promise<Book[]> {
  return Promise.all(
    (
      await storage().all<{
        document: string;
      }>("SELECT document FROM books ORDER BY updated_at DESC")
    ).map(async (r) => {
      const book = JSON.parse(r.document) as Book;
      book.pages = (
        await storage().all<{
          document: string;
        }>(
          "SELECT document FROM pages WHERE book_id=? ORDER BY position",
          book.id,
        )
      ).map((p) => JSON.parse(p.document));
      return book;
    }),
  );
}
export async function bookById(id: string): Promise<Book> {
  const book = (await books()).find((b) => b.id === id);
  if (!book) throw new AppError("Book not found.", 404);
  return book;
}
async function writeBook(book: Book) {
  await storage().run(
    "INSERT INTO books (id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at",
    book.id,
    JSON.stringify({ ...book, pages: [] }),
    book.updatedAt,
  );
  await storage().run("DELETE FROM pages WHERE book_id=?", book.id);
  for (const [i, p] of book.pages.entries())
    await storage().run(
      "INSERT INTO pages VALUES (?, ?, ?, ?)",
      p.id,
      book.id,
      i,
      JSON.stringify(p),
    );
}
export async function createBook(
  title: string,
  author: string,
  count: number,
  sourceId?: string,
) {
  const p = await preferences(),
    timestamp = now();
  const savedDefault = await get<{ id: string }>(
    "settings",
    "default-source-template",
  );
  const templates = await list<Template>("templates");
  const template =
    templates.find((t) => t.id === (savedDefault?.id ?? "DAHaJgBbCJ4")) ??
    templates.find((t) => t.pageCount === count);
  const book: Book = {
    id: randomUUID(),
    title,
    author,
    status: "draft",
    width: p.width,
    height: p.height,
    margin: p.margin,
    font: p.font,
    templateId: sourceId ?? template?.id ?? null,
    pages: Array.from({ length: count }, blankPage),
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await storage().transaction(async () => await writeBook(book));
  return book;
}
export async function saveBook(book: Book) {
  return await storage().transaction(async () => {
    const current = await bookById(book.id);
    if (book.revision !== current.revision)
      throw new AppError(
        "This book changed in another tab. Reload before editing to avoid overwriting it.",
        409,
      );
    if (book.templateId && !(await get<Template>("templates", book.templateId)))
      throw new AppError("Template not found.");
    const known = new Set((await list<Asset>("assets")).map((a) => a.id));
    if (book.pages.some((p) => p.assetId && !known.has(p.assetId)))
      throw new AppError("An assigned illustration no longer exists.");
    const updated = {
      ...book,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    await writeBook(updated);
    if (updated.templateId)
      await put("settings", "default-source-template", {
        id: updated.templateId,
      });
    return updated;
  });
}
export async function duplicateBook(id: string) {
  const source = await bookById(id),
    timestamp = now();
  const copy = {
    ...source,
    id: randomUUID(),
    title: `${source.title} (copy)`.slice(0, 255),
    status: "draft" as const,
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    pages: source.pages.map((p) => ({ ...p, id: randomUUID() })),
  };
  await storage().transaction(async () => await writeBook(copy));
  return copy;
}
export async function checkpoint(id: string) {
  const book = await bookById(id),
    version = { id: randomUUID(), createdAt: now(), book };
  await storage().run(
    "INSERT INTO versions VALUES (?, ?, ?, ?)",
    version.id,
    id,
    version.createdAt,
    JSON.stringify(book),
  );
  return version;
}
export async function versions(id: string) {
  return (
    await storage().all<{
      id: string;
      created_at: string;
      document: string;
    }>(
      "SELECT * FROM versions WHERE book_id=? ORDER BY created_at DESC LIMIT 30",
      id,
    )
  ).map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    book: JSON.parse(r.document) as Book,
  }));
}
export async function saveJob(job: PublishJob) {
  await storage().run(
    "INSERT INTO publishing_jobs (id,book_id,document) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
    job.id,
    job.bookId,
    JSON.stringify({ ...job, updatedAt: now() }),
  );
}
export async function registerTemplate(id: string, name: string) {
  if (await get("templates", id))
    throw new AppError("This design is already registered.", 409);
  const template: Template = {
    id,
    name,
    pageCount: null,
    dataset: null,
    mapping: [],
    checkedAt: null,
    error: null,
  };
  await put("templates", id, template);
  return template;
}
export async function initialize() {
  if (await get("settings", "initialized")) return;
  await storage().transaction(async () => {
    if (await get("settings", "initialized")) return;
    const id = process.env.CANVA_TEMPLATE_DESIGN_ID || "DAHaJgBbCJ4";
    if (!(await get("templates", id)))
      await put("templates", id, {
        id,
        name: "Automated Template Builder",
        pageCount: null,
        dataset: null,
        mapping: defaultMapping(33),
        checkedAt: null,
        error: null,
      } satisfies Template);
    await createBook("Aves Adventures — Nervous Cake", "", 33, id);
    await put("settings", "initialized", true);
  });
}
