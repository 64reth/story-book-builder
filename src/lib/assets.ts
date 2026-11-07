import { randomUUID } from "node:crypto";
import {
  readArtwork,
  writeArtwork,
  deleteArtwork,
  artworkBody,
} from "./artwork-store";
import path from "node:path";
import { canonicalImage } from "@/lib/image-codec";
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
  const old = replaceId ? await get<Asset>("assets", replaceId) : undefined;
  if (replaceId && !old) throw new AppError("Asset not found.", 404);
  const buffer = Buffer.from(await file.arrayBuffer());
  let decoded: Awaited<ReturnType<typeof canonicalImage>>;
  try {
    decoded = await canonicalImage(buffer);
  } catch {
    throw new AppError(
      "This image could not be decoded. Upload a valid single-frame PNG, JPEG or WebP.",
    );
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
    filename: `${randomUUID()}.${decoded.format}`,
    mime: formats[decoded.format],
    width: decoded.width,
    height: decoded.height,
    size: decoded.bytes.length,
    createdAt: now(),
  };
  await writeArtwork(asset.filename, decoded.bytes, asset.mime);
  await put("assets", asset.id, asset);
  // Immutable files keep in-progress publishing snapshots valid after replacement.
  return asset;
}
export async function readAsset(asset: Asset) {
  try {
    return await readArtwork(asset.filename);
  } catch {
    throw new AppError(
      `Illustration “${asset.name}” is missing from local storage. Replace it in Assets.`,
      409,
    );
  }
}
export async function assetBody(asset: Asset) {
  try {
    return await artworkBody(asset.filename);
  } catch {
    throw new AppError(
      `Illustration “${asset.name}” is unavailable in storage. Replace it in Assets.`,
      409,
    );
  }
}
export async function removeAsset(id: string) {
  const asset = await storage().transaction(async () => {
    const asset = await get<Asset>("assets", id);
    if (!asset) throw new AppError("Asset not found.", 404);
    const referenced = (await books()).some((b) =>
      b.pages.some((p) => p.assetId === id),
    );
    const jobReference = (await list<PublishJob>("publishing_jobs")).some((j) =>
      j.snapshot.assets.some((a) => a.id === id),
    );
    const versionReference = (
      await storage().all<{
        document: string;
      }>("SELECT document FROM versions")
    ).some((r) =>
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
    await storage().run("DELETE FROM assets WHERE id=?", id);
    return asset;
  });
  await deleteArtwork(asset.filename);
}
