import { ZodError, z } from "zod";

import {
  AppError,
  bookById,
  books,
  checkpoint,
  createBook,
  duplicateBook,
  get,
  initialize,
  list,
  preferences,
  put,
  registerTemplate,
  saveBook,
  versions,
} from "@/lib/repository";
import {
  connection,
  disconnect,
  inspectTemplate,
  startOAuth,
} from "@/lib/canva";
import {
  cookieValue,
  localBoundary,
  makeOwner,
  ownerCookie,
  requireOwner,
  validOwner,
} from "@/lib/security";
import { assetBody, removeAsset, upload } from "@/lib/assets";
import {
  bookEdit,
  bookInput,
  mappingSchema,
  preferencesSchema,
  templateInput,
} from "@/lib/schema";
import {
  advanceJob,
  recheckJob,
  jobSummary,
  publishingValidation,
  startPublishing,
} from "@/lib/publishing";

import type { Asset, PublishJob, Template } from "@/lib/types";
import {
  activeDraft,
  draftCandidates,
  refinementPlan,
  selectDraft,
} from "@/lib/refinement";
const response = (data: unknown, status = 200, headers: HeadersInit = {}) =>
  Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
async function json(request: Request) {
  const raw = await request.text();
  if (raw.length > 3000000) throw new AppError("Request is too large.", 413);
  try {
    return JSON.parse(raw);
  } catch {
    throw new AppError("Invalid JSON request.");
  }
}
type Context = {
  params: Promise<{
    path: string[];
  }>;
};
async function handler(request: Request, context: Context) {
  try {
    const { path: segments } = await context.params,
      [section, id, action] = segments,
      method = request.method;
    if (section === "workspace" && method === "GET") {
      localBoundary(request);
      if (process.env.STORYBOOK_DEPLOYED === "1") requireOwner(request);
      await initialize();
      const owner = cookieValue(request),
        cookie = validOwner(owner) ? owner : makeOwner();
      const assets = await list<Asset>("assets");
      const bytes = assets.reduce((sum, asset) => sum + asset.size, 0);
      return response(
        {
          books: await books(),
          assets,
          templates: await list<Template>("templates"),
          jobs: (await list<PublishJob>("publishing_jobs"))
            .map(jobSummary)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          preferences: await preferences(),
          connection: await connection(),
          storage: { bytes, assets: assets.length },
        },
        200,
        { "Set-Cookie": ownerCookie(cookie) },
      );
    }
    requireOwner(request, method !== "GET");
    await initialize();
    if (section === "books") {
      if (method === "POST" && !id) {
        const input = bookInput.parse(await json(request));
        return response(
          await createBook(input.title, input.author, input.pageCount),
          201,
        );
      }
      if (id) {
        if (method === "GET" && action === "versions")
          return response(await versions(id));
        if (method === "GET" && !action) return response(await bookById(id));
        if (method === "PUT" && !action) {
          const input = bookEdit.parse(await json(request));
          return response(
            await saveBook({ ...(await bookById(id)), ...input }),
          );
        }
        if (method === "POST" && action === "duplicate")
          return response(await duplicateBook(id), 201);
        if (method === "POST" && action === "versions")
          return response(await checkpoint(id), 201);
        if (method === "POST" && action === "restore") {
          const input = z
            .object({ versionId: z.string().uuid() })
            .parse(await json(request));
          const version = (await versions(id)).find(
            (v) => v.id === input.versionId,
          );
          if (!version) throw new AppError("Version not found.", 404);
          await checkpoint(id);
          return response(
            await saveBook({
              ...version.book,
              revision: (await bookById(id)).revision,
            }),
          );
        }
        if (method === "POST" && action === "validate")
          return response(await publishingValidation(id, true));
        if (method === "POST" && action === "publish") {
          const input = z
            .object({
              operation: z
                .enum(["create_from_design", "update_design"])
                .default("create_from_design"),
              approved: z
                .object({
                  fields: z.array(z.string()),
                  revision: z.number().int(),
                  designId: z.string(),
                })
                .optional(),
            })
            .parse(await request.json().catch(() => ({})));
          return response(
            await startPublishing(id, input.operation, input.approved),
            201,
          );
        }
        if (method === "GET" && action === "drafts")
          return response({
            active: await activeDraft(id),
            candidates: await draftCandidates(id),
          });
        if (method === "POST" && action === "drafts")
          return response(
            await selectDraft(
              id,
              z.object({ designId: z.string() }).parse(await json(request))
                .designId,
            ),
          );
        if (method === "POST" && action === "refinement-plan")
          return response(await refinementPlan(id));
      }
    }
    if (section === "assets") {
      if ((method === "POST" && !id) || (method === "PUT" && id)) {
        if (
          Number(request.headers.get("content-length") || 0) >
          26 * 1024 * 1024
        )
          throw new AppError("Upload limit is 25 MB per image.", 413);
        const form = await request.formData(),
          file = form.get("file");
        if (!(file instanceof File))
          throw new AppError("Choose an image to upload.");
        return response(await upload(file, id), 201);
      }
      if (method === "GET" && id) {
        const asset = await get<Asset>("assets", id);
        if (!asset) throw new AppError("Asset not found.", 404);
        const { body, size } = await assetBody(asset);
        return new Response(body, {
          headers: {
            "Content-Type": asset.mime,
            "Content-Length": String(size),
            // Preserve size through framework response wrapping. The Worker
            // removes this header and enforces framing at its outer boundary.
            ...(process.env.STORYBOOK_DEPLOYED === "1" ? { "X-Storybook-Artwork-Length": String(size) } : {}),
            "Cache-Control": "private, max-age=0, must-revalidate, no-transform",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
          },
        });
      }
      if (method === "PATCH" && id) {
        const asset = await get<Asset>("assets", id);
        if (!asset) throw new AppError("Asset not found.", 404);
        const { name } = z
          .object({ name: z.string().trim().min(1).max(150) })
          .parse(await json(request));
        await put("assets", id, { ...asset, name });
        return response({ ...asset, name });
      }
      if (method === "DELETE" && id) {
        await removeAsset(id);
        return response({ ok: true });
      }
    }
    if (section === "templates") {
      if (method === "POST" && !id) {
        const input = templateInput.parse(await json(request));
        return response(await registerTemplate(input.id, input.name), 201);
      }
      if (method === "POST" && id && action === "inspect")
        return response(await inspectTemplate(id));
      if (method === "PUT" && id) {
        const template = await get<Template>("templates", id);
        if (!template) throw new AppError("Template not found.", 404);
        const mapping = mappingSchema.parse(await json(request));
        await put("templates", id, { ...template, mapping });
        return response({ ...template, mapping });
      }
    }
    if (section === "jobs" && id && method === "POST" && action === "advance")
      return response(await advanceJob(id));
    if (section === "jobs" && id && method === "POST" && action === "recheck")
      return response(await recheckJob(id));
    if (section === "settings" && method === "PUT") {
      const input = preferencesSchema.parse(await json(request));
      await put("settings", "preferences", input);
      return response(input);
    }
    if (section === "canva" && method === "POST") {
      if (id === "connect")
        return response({ url: await startOAuth(cookieValue(request)) });
      if (id === "disconnect") {
        await disconnect();
        return response({ ok: true });
      }
    }
    throw new AppError("Endpoint not found.", 404);
  } catch (error) {
    if (error instanceof ZodError)
      return response(
        {
          error: error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        },
        400,
      );
    if (error instanceof AppError)
      return response({ error: error.message }, error.status);
    console.error("Unexpected workspace failure", error);
    return response(
      {
        error:
          "The operation failed. Check local storage permissions and application configuration.",
      },
      500,
    );
  }
}
export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
