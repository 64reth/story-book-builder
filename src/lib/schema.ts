import { z } from "zod";
import type { Validation, Workspace } from "./types";
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

const issueSchema = z.object({
  code: z.string(),
  message: z.string(),
  page: z.number().optional(),
});
export const validationSchema: z.ZodType<Validation> = z.object({
  errors: z.array(issueSchema),
  warnings: z.array(issueSchema),
  details: z.array(issueSchema).optional(),
  skipped: z
    .array(
      z.object({
        page: z.number().optional(),
        field: z.string(),
        kind: z.enum(["text", "image"]).optional(),
        reason: z.string(),
        populated: z.boolean(),
      }),
    )
    .optional(),
  submission: z
    .object({ textFields: z.number(), imageFields: z.number() })
    .optional(),
});
// Validate startup data before it is committed to the client tree.
export const workspaceResponseSchema: z.ZodType<Workspace> = z.object({
  books: z.array(
    bookEdit.safeExtend({
      id: z.string().uuid(),
      createdAt: z.string(),
      updatedAt: z.string(),
    }),
  ),
  assets: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      filename: z.string(),
      mime: z.string(),
      width: z.number(),
      height: z.number(),
      size: z.number(),
      createdAt: z.string(),
    }),
  ),
  templates: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pageCount: z.number().nullable(),
      dataset: z.record(z.string(), z.object({ type: z.string() })).nullable(),
      mapping: mappingSchema,
      checkedAt: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ),
  jobs: z.array(
    z.object({
      id: z.string(),
      bookId: z.string(),
      title: z.string(),
      status: z.enum([
        "queued",
        "uploading",
        "generating",
        "success",
        "failed",
      ]),
      message: z.string(),
      progress: z.number(),
      createdAt: z.string(),
      updatedAt: z.string(),
      nextAt: z.number(),
      attempts: z.number(),
      remoteId: z.string().optional(),
      designId: z.string().optional(),
      designUrl: z.string().optional(),
      operation: z.enum(["create_from_design", "update_design"]).optional(),
      resultType: z.enum(["create_design", "update_design"]).optional(),
      targetDesignId: z.string().optional(),
      manifest: z.record(z.string(), z.string()).optional(),
      completedAt: z.string().optional(),
      confirmedAt: z.string().optional(),
      validation: validationSchema.optional(),
    }),
  ),
  preferences: preferencesSchema,
  connection: z.object({
    connected: z.boolean(),
    configured: z.boolean(),
    missing: z.array(z.string()),
  }),
  storage: z.object({ bytes: z.number(), assets: z.number() }),
});
