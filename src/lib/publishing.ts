import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import {
  accessToken,
  connection,
  inspectTemplate,
  remoteJob,
  CanvaError,
  canva,
  providerCode,
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
  put,
} from "./repository";
import { storage } from "./storage";
import { buildAutofill, planAutofill, validateBook } from "./validation";
import { fieldManifest, refinementPlan, MASTER } from "./refinement";
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
  if (
    job.status === "success" &&
    (!job.remoteId ||
      job.remoteId === "uncertain" ||
      !job.designId ||
      !job.designUrl)
  )
    return {
      ...summary,
      status: "failed",
      message:
        "Stored completion is missing its Canva job ID, design ID or result URL. Check the existing job status before creating another draft.",
    };
  return { ...summary, operation: job.operation ?? "create_from_design" };
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
export async function startPublishing(
  bookId: string,
  operation: "create_from_design" | "update_design" = "create_from_design",
  approved?: { fields: string[]; revision: number; designId: string },
) {
  const refinement =
    operation === "update_design" ? await refinementPlan(bookId) : null;
  if (
    refinement &&
    (!approved ||
      approved.revision !== refinement.revision ||
      approved.designId !== refinement.designId ||
      JSON.stringify([...approved.fields].sort()) !==
        JSON.stringify(refinement.fields.map((f) => f.field).sort()))
  )
    throw new AppError(
      "Review the current affected fields before refining. The book or destination may have changed.",
      409,
    );
  if (refinement && !refinement.fields.length)
    throw new AppError(
      "No fields have changed since the last successful submission. No Canva job was created.",
      409,
    );
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
    if (refinement && book.revision !== refinement.revision)
      throw new AppError(
        "The book changed during validation. Review the affected fields again.",
        409,
      );
    const fields =
      refinement?.fields ??
      planAutofill(book, template, assets, unavailable).fields;
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
      operation,
      targetDesignId: refinement?.designId,
      manifest: refinement?.manifest ?? fieldManifest(fields, assets),
    };
    saveJob(job);
    return jobSummary(job);
  });
}
function checkRemote(remote: RemoteJob) {
  if (remote.status === "failed")
    throw new AppError(
      `Canva job failed (${providerCode(remote.error?.code)}). Check the asset, template access and Canva plan. No successful design was confirmed.`,
      502,
    );
}
// Both normal polling and explicit recovery use GETs only after submission.
// Never accept an HTTP 200 or a pending job as a completed design.
async function confirmCreation(job: PublishJob, remote: RemoteJob) {
  checkRemote(remote);
  const design = remote.result?.design;
  if (
    remote.id !== job.remoteId ||
    remote.status !== "success" ||
    remote.result?.type !==
      (job.operation === "update_design" ? "update_design" : "create_design") ||
    typeof design?.id !== "string" ||
    !design.id.trim() ||
    design.id === job.snapshot.template.id ||
    design.id === MASTER ||
    (job.operation === "update_design" && design.id !== job.targetDesignId)
  )
    throw new AppError(
      "Canva returned an unexpected generation result. No completion was confirmed. Inspect the recorded job in Canva.",
      502,
    );
  const meta = await canva<{
    design: { id: string; page_count?: number; urls?: { edit_url?: string } };
  }>(`/designs/${encodeURIComponent(design.id)}`);
  if (meta?.design?.id !== design.id)
    throw new AppError(
      "Canva design lookup did not match the generated design ID. No completion was confirmed.",
      502,
    );
  if (
    job.snapshot.template.pageCount !== null &&
    meta.design.page_count !== job.snapshot.template.pageCount
  )
    throw new AppError(
      `Generated design page count did not match the ${job.snapshot.template.pageCount}-page source. Inspect design ${design.id} in Canva.`,
      502,
    );
  const url = meta.design.urls?.edit_url || design.urls?.edit_url || design.url;
  let validUrl = false;
  try {
    const parsed = new URL(url!);
    validUrl =
      parsed.protocol === "https:" &&
      ["canva.com", "www.canva.com"].includes(parsed.hostname) &&
      !parsed.username &&
      !parsed.password &&
      !parsed.port &&
      /^\/(api\/)?design\//.test(parsed.pathname);
  } catch {
    /* Invalid or missing provider URL. */
  }
  if (!validUrl)
    throw new AppError(
      "Canva did not return a valid edit URL. Retry the status check to recover the result.",
      502,
    );
  job.designId = design.id;
  job.designUrl = url;
  job.operation ??= "create_from_design";
  job.resultType = remote.result!.type as "create_design" | "update_design";
  job.completedAt ??= job.status === "success" ? job.updatedAt : now();
  job.confirmedAt = now();
  job.status = "success";
  job.progress = 100;
  job.message =
    job.operation === "update_design"
      ? `UPDATED Canva design ${design.id}. Only reviewed changed fields were submitted.`
      : `CREATED Canva design ${design.id}. Existing Canva books were not updated.`;
  storage().transaction(() => {
    // Keep the original generated-design creation timestamp when refreshing links.
    const previous = storage().get<{ document: string }>(
      "SELECT document FROM generated_designs WHERE id=?",
      design.id,
    );
    const record = previous
      ? JSON.parse(previous.document)
      : { id: design.id, createdAt: job.completedAt };
    storage().run(
      "INSERT OR REPLACE INTO generated_designs VALUES (?, ?, ?, ?)",
      design.id,
      job.id,
      job.bookId,
      JSON.stringify({
        ...record,
        url,
        remoteId: job.remoteId,
        operation: job.operation,
        resultType: job.resultType,
        confirmedAt: job.confirmedAt,
      }),
    );
    saveJob(job);
    put("settings", `active-draft:${job.bookId}`, { designId: design.id });
  });
}

export async function recheckJob(id: string) {
  let job = get<PublishJob>("publishing_jobs", id);
  if (!job) throw new AppError("Publishing job not found.", 404);
  if (!job.remoteId || job.remoteId === "uncertain")
    throw new AppError(
      "No confirmed Autofill job ID is available. Check Canva manually; this request will not be replayed.",
      409,
    );
  const lease = storage().run(
    "UPDATE publishing_jobs SET lease_until=? WHERE id=? AND lease_until < ?",
    Date.now() + 90000,
    id,
    Date.now(),
  );
  if (!lease.changes)
    throw new AppError(
      "A status check is already running. Try again shortly.",
      409,
    );
  job = get<PublishJob>("publishing_jobs", id)!;
  try {
    if (!job.remoteId || job.remoteId === "uncertain")
      throw new AppError(
        "No confirmed Autofill job ID is available. This request will not be replayed.",
        409,
      );
    const remote = await remoteJob(
      `/autofills/${encodeURIComponent(job.remoteId)}`,
      undefined,
      job.remoteId,
    );
    checkRemote(remote);
    if (remote.status === "success") await confirmCreation(job, remote);
    else {
      if (job.status === "success")
        throw new AppError(
          "Canva now reports an incomplete job. The previous completion record has been preserved; check account access before retrying.",
          502,
        );
      // Resume only the known job's safe polling stage. Never replay its POST.
      job.status = "generating";
      job.attempts = 0;
      job.nextAt = 0;
      job.message =
        "Canva job is still generating. Status checks resumed; no new design was requested.";
      saveJob(job);
    }
    return jobSummary(job);
  } finally {
    storage().run("UPDATE publishing_jobs SET lease_until=0 WHERE id=?", id);
  }
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
          checkRemote(remote);
          job.attempts = 0;
        } else if (job.pendingUpload.remoteId === "uncertain")
          throw new AppError(
            "Upload outcome is unknown after an interruption. Check Canva’s uploads before starting a new job.",
            409,
          );
        else {
          const remote = await remoteJob(
            `/asset-uploads/${encodeURIComponent(job.pendingUpload.remoteId)}`,
            undefined,
            job.pendingUpload.remoteId,
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
        const submission =
          job.operation === "update_design"
            ? {
                ...payload,
                type: "update_design",
                design_id: job.targetDesignId,
              }
            : payload;
        if (
          job.operation === "update_design" &&
          (!job.targetDesignId ||
            job.targetDesignId === MASTER ||
            job.targetDesignId === job.snapshot.template.id)
        )
          throw new AppError(
            "Protected or missing update destination. No Canva request was submitted.",
            422,
          );
        job.status = "generating";
        job.remoteId = "uncertain";
        job.message = "Submitting Canva Autofill";
        saveJob(job);
        const remote = await remoteJob("/autofills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(submission),
        });
        job.remoteId = remote.id;
        checkRemote(remote);
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
        undefined,
        job.remoteId,
      );
      checkRemote(remote);
      if (remote.status === "success") {
        await confirmCreation(job, remote);
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
