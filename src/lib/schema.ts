import { z } from "zod";
export const preferencesSchema = z
  .object({
    width: z.number().min(1).max(30),
    height: z.number().min(1).max(30),
    margin: z.number().min(0).max(2),
    font: z.string().trim().min(1).max(100),
    dpi: z.number().int().min(72).max(600),
    exportFormat: z.enum(["pdf_print", "png"]),
    theme: z.enum(["light", "dark"]),
  })
  .refine(
    (v) => v.margin * 2 < Math.min(v.width, v.height),
    "Safe margin must fit inside the page.",
  );
export const pageSchema = z.object({
  id: z.string().uuid(),
  text: z.string().max(20000),
  assetId: z.string().uuid().nullable(),
  placement: z.enum(["cover", "contain"]),
  bubbleColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  bubbleOpacity: z.number().min(0).max(1),
  textPosition: z.enum(["top", "center", "bottom"]),
  fontSize: z.number().min(12).max(80),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
});
export const bookInput = z.object({
  title: z.string().trim().min(1).max(255),
  author: z.string().trim().max(200).default(""),
  pageCount: z
    .union([z.literal(24), z.literal(28), z.literal(32), z.literal(33)])
    .default(33),
});
export const bookEdit = z
  .object({
    title: z.string().trim().min(1).max(255),
    author: z.string().trim().max(200),
    status: z.enum(["draft", "review", "archived"]),
    templateId: z.string().max(100).nullable(),
    width: z.number().min(1).max(30),
    height: z.number().min(1).max(30),
    margin: z.number().min(0).max(2),
    font: z.string().min(1).max(100),
    pages: z.array(pageSchema).min(1).max(100),
    revision: z.number().int().min(0),
  })
  .refine(
    (v) => new Set(v.pages.map((p) => p.id)).size === v.pages.length,
    "Page IDs must be unique.",
  )
  .refine(
    (v) => [24, 28, 32, 33].includes(v.pages.length),
    "Use a supported page count.",
  )
  .refine(
    (v) => v.margin * 2 < Math.min(v.width, v.height),
    "Safe margin must fit inside the page.",
  );
export const templateInput = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{5,100}$/),
  name: z.string().trim().min(1).max(255),
});
export const mappingSchema = z
  .array(z.object({ image: z.string().max(255), text: z.string().max(255) }))
  .max(100);
