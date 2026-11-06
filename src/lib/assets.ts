import { randomUUID } from "node:crypto";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import { AppError, books, get, list, now, put } from "./repository";
import { storage, uploadRoot } from "./storage";
import type { Asset, PublishJob } from "./types";
const formats: Record<string, string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  webp: "image/webp",
};
export function assetPath(filename: string) {
  if (!/^[a-f0-9-]+\.(png|jpeg|webp)$/.test(filename))
    throw new AppError("Invalid asset path.");
  return path.join(uploadRoot(), filename);
}
export async function upload(file: File, replaceId?: string) {
  if (!file.size || file.size > 25 * 1024 * 1024)
    throw new AppError("Upload an image between 1 byte and 25 MB.");
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
    throw new AppError("Supported formats are PNG, JPEG and WebP.");
  const old = replaceId ? get<Asset>("assets", replaceId) : undefined;
  if (replaceId && !old) throw new AppError("Asset not found.", 404);
  const buffer = Buffer.from(await file.arrayBuffer());
  let metadata: Metadata;
  try {
    metadata = await sharp(buffer, {
      limitInputPixels: 80000000,
      animated: false,
    }).metadata();
  } catch {
    throw new AppError(
      "This image could not be decoded. Upload a valid PNG, JPEG or WebP.",
    );
  }
  if (
    !metadata.format ||
    !formats[metadata.format] ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) > 1
  )
    throw new AppError("Upload a single-frame PNG, JPEG or WebP image.");
  let canonical: Buffer, info: OutputInfo;
  try {
    const result = await sharp(buffer, { limitInputPixels: 80000000 })
      .rotate()
      .toFormat(metadata.format as "png" | "jpeg" | "webp")
      .toBuffer({ resolveWithObject: true });
    canonical = result.data;
    info = result.info;
  } catch {
    throw new AppError("Image decoding failed.");
  }
  const asset: Asset = {
    id: old?.id ?? randomUUID(),
    name:
      old?.name ??
      (file.name
        .replace(/\.[^.]+$/, "")
        .trim()
        .slice(0, 150) ||
        "Untitled illustration"),
    filename: `${randomUUID()}.${metadata.format}`,
    mime: formats[metadata.format],
    width: info.width,
    height: info.height,
    size: canonical.length,
    createdAt: now(),
  };
  await writeFile(assetPath(asset.filename), canonical, { flag: "wx" });
  put("assets", asset.id, asset);
  // Immutable files keep in-progress publishing snapshots valid after replacement.
  return asset;
}
export async function readAsset(asset: Asset) {
  try {
    return await readFile(assetPath(asset.filename));
  } catch {
    throw new AppError(
      `Illustration “${asset.name}” is missing from local storage. Replace it in Assets.`,
      409,
    );
  }
}
export async function removeAsset(id: string) {
  const asset = storage().transaction(() => {
    const asset = get<Asset>("assets", id);
    if (!asset) throw new AppError("Asset not found.", 404);
    const referenced = books().some((b) =>
      b.pages.some((p) => p.assetId === id),
    );
    const jobReference = list<PublishJob>("publishing_jobs").some((j) =>
      j.snapshot.assets.some((a) => a.id === id),
    );
    const versionReference = storage()
      .all<{ document: string }>("SELECT document FROM versions")
      .some((r) =>
        JSON.parse(r.document).pages.some(
          (p: { assetId: string }) => p.assetId === id,
        ),
      );
    if (referenced || jobReference || versionReference)
      throw new AppError(
        "This illustration is referenced by a book, saved version or publishing job. It cannot be removed.",
        409,
      );
    // Remove the assignable record under the same lock as the reference check.
    storage().run("DELETE FROM assets WHERE id=?", id);
    return asset;
  });
  await unlink(assetPath(asset.filename)).catch((e: NodeJS.ErrnoException) => {
    if (e.code !== "ENOENT") throw e;
  });
}
