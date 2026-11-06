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
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
type Table = "assets" | "templates" | "publishing_jobs" | "settings";
export const now = () => new Date().toISOString();
export function list<T>(table: Table): T[] {
  return storage()
    .all<{ document: string }>(`SELECT document FROM ${table}`)
    .map((r) => JSON.parse(r.document));
}
export function get<T>(table: Table, id: string): T | undefined {
  const row = storage().get<{ document: string }>(
    `SELECT document FROM ${table} WHERE id=?`,
    id,
  );
  return row ? JSON.parse(row.document) : undefined;
}
export function put(
  table: Exclude<Table, "publishing_jobs">,
  id: string,
  doc: unknown,
) {
  storage().run(
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
export function preferences() {
  return get<Preferences>("settings", "preferences") ?? defaults;
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
export function books(): Book[] {
  return storage()
    .all<{ document: string }>(
      "SELECT document FROM books ORDER BY updated_at DESC",
    )
    .map((r) => {
      const book = JSON.parse(r.document) as Book;
      book.pages = storage()
        .all<{ document: string }>(
          "SELECT document FROM pages WHERE book_id=? ORDER BY position",
          book.id,
        )
        .map((p) => JSON.parse(p.document));
      return book;
    });
}
export function bookById(id: string): Book {
  const book = books().find((b) => b.id === id);
  if (!book) throw new AppError("Book not found.", 404);
  return book;
}
function writeBook(book: Book) {
  storage().run(
    "INSERT INTO books (id, document, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document, updated_at=excluded.updated_at",
    book.id,
    JSON.stringify({ ...book, pages: [] }),
    book.updatedAt,
  );
  storage().run("DELETE FROM pages WHERE book_id=?", book.id);
  book.pages.forEach((p, i) =>
    storage().run(
      "INSERT INTO pages VALUES (?, ?, ?, ?)",
      p.id,
      book.id,
      i,
      JSON.stringify(p),
    ),
  );
}
export function createBook(title: string, author: string, count: number) {
  const p = preferences(),
    timestamp = now();
  const template = list<Template>("templates").find(
    (t) => t.pageCount === count,
  );
  const book: Book = {
    id: randomUUID(),
    title,
    author,
    status: "draft",
    width: p.width,
    height: p.height,
    margin: p.margin,
    font: p.font,
    templateId: template?.id ?? null,
    pages: Array.from({ length: count }, blankPage),
    revision: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  storage().transaction(() => writeBook(book));
  return book;
}
export function saveBook(book: Book) {
  return storage().transaction(() => {
    const current = bookById(book.id);
    if (book.revision !== current.revision)
      throw new AppError(
        "This book changed in another tab. Reload before editing to avoid overwriting it.",
        409,
      );
    if (book.templateId && !get<Template>("templates", book.templateId))
      throw new AppError("Template not found.");
    const known = new Set(list<Asset>("assets").map((a) => a.id));
    if (book.pages.some((p) => p.assetId && !known.has(p.assetId)))
      throw new AppError("An assigned illustration no longer exists.");
    const updated = {
      ...book,
      revision: current.revision + 1,
      updatedAt: now(),
    };
    writeBook(updated);
    return updated;
  });
}
export function duplicateBook(id: string) {
  const source = bookById(id),
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
  storage().transaction(() => writeBook(copy));
  return copy;
}
export function checkpoint(id: string) {
  const book = bookById(id),
    version = { id: randomUUID(), createdAt: now(), book };
  storage().run(
    "INSERT INTO versions VALUES (?, ?, ?, ?)",
    version.id,
    id,
    version.createdAt,
    JSON.stringify(book),
  );
  return version;
}
export function versions(id: string) {
  return storage()
    .all<{ id: string; created_at: string; document: string }>(
      "SELECT * FROM versions WHERE book_id=? ORDER BY created_at DESC LIMIT 30",
      id,
    )
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      book: JSON.parse(r.document) as Book,
    }));
}
export function saveJob(job: PublishJob) {
  storage().run(
    "INSERT INTO publishing_jobs (id,book_id,document) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document",
    job.id,
    job.bookId,
    JSON.stringify({ ...job, updatedAt: now() }),
  );
}
export function registerTemplate(id: string, name: string) {
  if (get("templates", id))
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
  put("templates", id, template);
  return template;
}
export function initialize() {
  if (get("settings", "initialized")) return;
  storage().transaction(() => {
    if (get("settings", "initialized")) return;
    const id = process.env.CANVA_TEMPLATE_DESIGN_ID || "DAHaJgBbCJ4";
    if (!get("templates", id))
      put("templates", id, {
        id,
        name: "Automated Template Builder",
        pageCount: null,
        dataset: null,
        mapping: defaultMapping(33),
        checkedAt: null,
        error: null,
      } satisfies Template);
    createBook("Aves Adventures — Nervous Cake", "", 33);
    put("settings", "initialized", true);
  });
}
