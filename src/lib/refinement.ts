import { createHash } from "node:crypto";
import { canva } from "./canva";
import { AppError, bookById, get, list, put } from "./repository";
import { planAutofill } from "./validation";
import type {
  Asset,
  AutofillField,
  Dataset,
  PublishJob,
  Template,
} from "./types";
export const MASTER = "DAHaJgBbCJ4";
export function fieldManifest(fields: AutofillField[], assets: Asset[]) {
  return Object.fromEntries(
    fields.map((f) => [
      f.field,
      createHash("sha256")
        .update(
          JSON.stringify(
            f.kind === "text"
              ? [f.kind, f.text]
              : [
                  f.kind,
                  assets.find((a) => a.id === f.assetId)?.filename ?? f.assetId,
                ],
          ),
        )
        .digest("hex"),
    ]),
  );
}
export function draftCandidates(bookId: string) {
  return list<PublishJob>("publishing_jobs")
    .filter(
      (j) =>
        j.bookId === bookId &&
        j.status === "success" &&
        j.designId &&
        j.designId !== MASTER,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .filter(
      (j, i, all) =>
        all.findIndex((other) => other.designId === j.designId) === i,
    )
    .map((j) => ({
      designId: j.designId!,
      url: j.designUrl,
      publishedAt: j.completedAt ?? j.updatedAt,
    }));
}
export function activeDraft(bookId: string) {
  return get<{ designId: string }>("settings", `active-draft:${bookId}`)
    ?.designId;
}
export async function inspectDestination(bookId: string, designId: string) {
  if (
    designId === MASTER ||
    !draftCandidates(bookId).some((d) => d.designId === designId)
  )
    throw new AppError(
      "Select a confirmed generated draft associated with this book. The protected master cannot be refined.",
      422,
    );
  const [meta, user, dataset] = await Promise.all([
    canva<{
      design: { id: string; owner?: { user_id: string; team_id: string } };
    }>(`/designs/${encodeURIComponent(designId)}`),
    canva<{ team_user: { user_id: string; team_id: string } }>("/users/me"),
    canva<{ dataset: Dataset }>(
      `/designs/${encodeURIComponent(designId)}/dataset`,
    ),
  ]);
  if (
    meta.design?.id !== designId ||
    !meta.design.owner ||
    !user.team_user ||
    meta.design.owner.user_id !== user.team_user.user_id ||
    meta.design.owner.team_id !== user.team_user.team_id
  )
    throw new AppError(
      "The selected draft is not owned by the authorised Canva user/team. Reconnect the intended account or create a new draft.",
      403,
    );
  if (
    !dataset.dataset ||
    Object.values(dataset.dataset).some((f) => !f || typeof f.type !== "string")
  )
    throw new AppError(
      "The destination has no usable dataset. Create a new draft instead.",
      422,
    );
  return dataset.dataset;
}
export async function selectDraft(bookId: string, designId: string) {
  await inspectDestination(bookId, designId);
  put("settings", `active-draft:${bookId}`, { designId });
  return { designId };
}
export async function refinementPlan(bookId: string) {
  const book = bookById(bookId),
    designId = activeDraft(bookId);
  if (!designId)
    throw new AppError(
      "Select an active generated Canva draft first. Existing copies are never selected automatically.",
      422,
    );
  const dataset = await inspectDestination(bookId, designId);
  const source = get<Template>("templates", book.templateId ?? "");
  if (!source) throw new AppError("Select the source template first.", 422);
  const assets = list<Asset>("assets");
  const plan = planAutofill(book, source, assets);
  const previous = list<PublishJob>("publishing_jobs")
    .filter(
      (j) =>
        j.bookId === bookId &&
        j.designId === designId &&
        j.status === "success",
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!previous)
    throw new AppError(
      "No confirmed submission baseline exists for this draft. Create a new draft.",
      422,
    );
  const before =
    previous.manifest ??
    fieldManifest(
      previous.snapshot.fields ??
        planAutofill(
          previous.snapshot.book,
          previous.snapshot.template,
          previous.snapshot.assets,
        ).fields,
      previous.snapshot.assets,
    );
  const current = fieldManifest(plan.fields, assets);
  const fields = plan.fields.filter(
    (f) => before[f.field] !== current[f.field],
  );
  const incompatible = fields.filter((f) => dataset[f.field]?.type !== f.kind);
  if (incompatible.length)
    throw new AppError(
      `Destination fields are missing or incompatible: ${incompatible.map((f) => f.field).join(", ")}. Correct the destination labels or create a new draft. No update was submitted.`,
      422,
    );
  return {
    designId,
    fields,
    manifest: { ...before, ...fieldManifest(fields, assets) },
    revision: book.revision,
    skipped: plan.skipped,
    warning:
      "These tagged fields may overwrite manual Canva edits. Untouched fields are omitted. Blank local fields retain existing Canva content.",
  };
}
