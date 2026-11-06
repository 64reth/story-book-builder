import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  accessToken,
  connection,
  inspectTemplate,
  remoteJob,
  CanvaError,
} from "./canva";
import { assetPath, readAsset } from "./assets";
import {
  AppError,
  bookById,
  checkpoint,
  get,
  list,
  now,
  preferences,
  saveJob,
} from "./repository";
import { storage } from "./storage";
import { buildAutofill, planAutofill, validateBook } from "./validation";
import type {
  Asset,
  JobSummary,
  PublishJob,
  RemoteJob,
  Template,
} from "./types";
export function jobSummary(job: PublishJob): JobSummary {
  const { snapshot: _, uploaded: __, pendingUpload: ___, ...summary } = job;
  void _;
  void __;
  void ___;
  return summary;
}
export async function publishingValidation(bookId: string, live = false) {
  const book = bookById(bookId);
  let inspectionError: string | undefined;
  if (live && book.templateId && connection().connected) {
    try {
      await inspectTemplate(book.templateId);
    } catch (error) {
      inspectionError =
        error instanceof Error
          ? error.message
          : "Canva source inspection failed. Check the connection and retry validation.";
    }
  }
  const assets = list<Asset>("assets");
  const unavailable = await unavailableAssets(
    assets.filter((a) => book.pages.some((p) => p.assetId === a.id)),
  );
  const result = validateBook(
    book,
    book.templateId ? get<Template>("templates", book.templateId) : undefined,
    assets,
    connection().connected,
    preferences().dpi,
    unavailable,
  );
  if (
    inspectionError &&
    !result.errors.some((issue) => issue.message === inspectionError)
  )
    result.errors.push({ code: "canva", message: inspectionError });
  return result;
}
async function unavailableAssets(assets: Asset[]) {
  const unavailable: string[] = [];
  for (const asset of assets) {
    try {
      const file = await stat(assetPath(asset.filename));
      if (!file.isFile() || file.size !== asset.size)
        throw new Error("File changed");
    } catch {
      unavailable.push(asset.id);
    }
  }
  return unavailable;
}
export async function startPublishing(bookId: string) {
  const validation = await publishingValidation(bookId, true);
  if (validation.errors.length)
    throw new AppError(validation.errors[0].message, 422);
  const unavailable = await unavailableAssets(list<Asset>("assets"));
  // Capture one immutable, validated revision after external awaits.
  return storage().transaction(() => {
    const book = bookById(bookId),
      template = get<Template>("templates", book.templateId!)!,
      assets = list<Asset>("assets").filter((a) =>
        book.pages.some((p) => p.assetId === a.id),
      );
    const checked = validateBook(
      book,
      template,
      assets,
      connection().connected,
      preferences().dpi,
      unavailable,
    );
    if (checked.errors.length)
      throw new AppError(checked.errors[0].message, 422);
    const fields = planAutofill(book, template, assets, unavailable).fields;
    const uploads = assets.filter((a) =>
      fields.some((f) => f.kind === "image" && f.assetId === a.id),
    );
    if (
      list<PublishJob>("publishing_jobs").some(
        (j) => !["success", "failed"].includes(j.status),
      )
    )
      throw new AppError(
        "A publishing job is already active. Resume it before generating another draft.",
        409,
      );
    checkpoint(bookId);
    const job: PublishJob = {
      id: randomUUID(),
      bookId,
      title: book.title,
      status: "queued",
      message: "Ready to upload illustrations",
      progress: 0,
      createdAt: now(),
      updatedAt: now(),
      nextAt: 0,
      attempts: 0,
      snapshot: {
        book,
        template,
        assets: uploads,
        dpi: preferences().dpi,
        fields,
      },
      validation: checked,
      uploaded: {},
    };
    saveJob(job);
    return jobSummary(job);
  });
}
function checkRemote(remote: RemoteJob) {
  if (remote.status === "failed")
    throw new AppError(
      `Canva job failed (${remote.error?.code || "unknown"}). Check the asset, template access and Canva plan, then generate a new draft.`,
      502,
    );
}
export async function advanceJob(id: string) {
  let job = get<PublishJob>("publishing_jobs", id);
  if (!job) throw new AppError("Publishing job not found.", 404);
  if (["success", "failed"].includes(job.status) || job.nextAt > Date.now())
    return jobSummary(job);
  const lease = storage().run(
    "UPDATE publishing_jobs SET lease_until=? WHERE id=? AND lease_until < ?",
    Date.now() + 90000,
    id,
    Date.now(),
  );
  if (!lease.changes) return jobSummary(job);
  // Re-read after acquiring the lease; another request may have advanced it.
  job = get<PublishJob>("publishing_jobs", id)!;
  try {
    await accessToken();
    if (job.attempts >= 40)
      throw new AppError(
        "Canva did not complete this stage after 40 polls. Review Canva before generating again; a remote draft may still finish.",
        504,
      );
    if (job.status === "queued") {
      job.status = "uploading";
      job.message = "Uploading illustrations to Canva";
    }
    if (job.status === "uploading") {
      const asset = job.snapshot.assets.find((a) => !job.uploaded[a.id]);
      if (asset) {
        if (!job.pendingUpload) {
          // Persist uncertainty before non-idempotent creation. A crash never replays a POST.
          job.message = `Starting upload: ${asset.name}`;
          job.pendingUpload = { assetId: asset.id, remoteId: "uncertain" };
          saveJob(job);
          const bytes = await readAsset(asset);
          const remote = await remoteJob("/asset-uploads", {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "Asset-Upload-Metadata": JSON.stringify({
                name_base64: Buffer.from(asset.name.slice(0, 50)).toString(
                  "base64",
                ),
              }),
            },
            body: new Uint8Array(bytes),
          });
          job.pendingUpload.remoteId = remote.id;
          job.attempts = 0;
        } else if (job.pendingUpload.remoteId === "uncertain")
          throw new AppError(
            "Upload outcome is unknown after an interruption. Check Canva’s uploads before starting a new job.",
            409,
          );
        else {
          const remote = await remoteJob(
            `/asset-uploads/${encodeURIComponent(job.pendingUpload.remoteId)}`,
          );
          checkRemote(remote);
          if (remote.status === "success") {
            if (!remote.asset?.id)
              throw new AppError(
                "Canva confirmed upload without an asset ID.",
                502,
              );
            job.uploaded[job.pendingUpload.assetId] = remote.asset.id;
            delete job.pendingUpload;
            job.attempts = 0;
          } else job.attempts++;
        }
        const done = Object.keys(job.uploaded).length;
        job.progress = Math.round((done / job.snapshot.assets.length) * 70);
        job.message = `Illustrations uploaded: ${done} / ${job.snapshot.assets.length}`;
      } else {
        const payload = buildAutofill(
          job.snapshot.book,
          job.snapshot.template,
          job.uploaded,
          job.snapshot.fields,
        );
        job.status = "generating";
        job.remoteId = "uncertain";
        job.message = "Submitting Canva Autofill";
        saveJob(job);
        const remote = await remoteJob("/autofills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        job.remoteId = remote.id;
        job.attempts = 0;
        job.progress = 75;
        job.message = "Canva is generating the editable draft";
      }
    } else if (job.status === "generating") {
      if (!job.remoteId || job.remoteId === "uncertain")
        throw new AppError(
          "Generation outcome is unknown after an interruption. Review your Canva designs before generating again; this request will not be replayed.",
          409,
        );
      const remote = await remoteJob(
        `/autofills/${encodeURIComponent(job.remoteId)}`,
      );
      checkRemote(remote);
      if (remote.status === "success") {
        const design = remote.result?.design;
        if (
          remote.result?.type !== "create_design" ||
          !design?.id ||
          design.id === job.snapshot.template.id
        )
          throw new AppError(
            "Canva returned an unexpected generation result. Inspect your Canva designs.",
            502,
          );
        job.designId = design.id;
        job.designUrl = design.urls?.edit_url || design.url;
        // Verify the real result count, even when Autofill omits it.
        const { canva } = await import("./canva");
        const meta = await canva<{
          design: { page_count?: number; urls?: { edit_url?: string } };
        }>(`/designs/${encodeURIComponent(design.id)}`);
        if (
          job.snapshot.template.pageCount !== null &&
          meta.design.page_count !== job.snapshot.template.pageCount
        )
          throw new AppError(
            `Generated design page count did not match the ${job.snapshot.template.pageCount}-page source. Inspect design ${design.id} in Canva.`,
            502,
          );
        job.designUrl = meta.design.urls?.edit_url || job.designUrl;
        if (
          !job.designUrl ||
          !/^https:\/\/(www\.)?canva\.com\//.test(job.designUrl)
        )
          throw new AppError("Canva did not return a valid edit URL.", 502);
        job.status = "success";
        job.progress = 100;
        job.message = "Editable Canva draft created";
        storage().run(
          "INSERT OR REPLACE INTO generated_designs VALUES (?, ?, ?, ?)",
          design.id,
          job.id,
          job.bookId,
          JSON.stringify({
            id: design.id,
            url: job.designUrl,
            createdAt: now(),
          }),
        );
      } else {
        job.attempts++;
        job.progress = Math.min(95, 75 + job.attempts);
      }
    }
    job.nextAt =
      Date.now() + Math.min(15000, 2000 * Math.pow(1.3, job.attempts));
    saveJob(job);
  } catch (e) {
    const message =
      e instanceof Error
        ? e.message
        : "Publishing could not continue. Check the local files and Canva connection.";
    // Only retry safe GET stages; never repeat a creation with an uncertain result.
    const safePoll =
      (job.pendingUpload?.remoteId &&
        job.pendingUpload.remoteId !== "uncertain") ||
      (job.status === "generating" &&
        job.remoteId &&
        job.remoteId !== "uncertain");
    if (e instanceof CanvaError && safePoll && job.attempts < 39) {
      job.attempts++;
      job.nextAt =
        Date.now() +
        Math.min(
          60000,
          Math.max(e.retryAfter * 1000, 3000 * Math.pow(1.4, job.attempts)),
        );
      job.message = message + " Retrying status check.";
    } else {
      job.status = "failed";
      job.message = message;
    }
    saveJob(job);
  } finally {
    storage().run("UPDATE publishing_jobs SET lease_until=0 WHERE id=?", id);
  }
  return jobSummary(job);
}
