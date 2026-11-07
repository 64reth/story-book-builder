import sharp from "sharp";
export async function canonicalImage(bytes: Buffer) {
  const metadata = await sharp(bytes, {
    limitInputPixels: 80000000,
    animated: false,
  }).metadata();
  if (
    !["png", "jpeg", "webp"].includes(metadata.format ?? "") ||
    !metadata.width ||
    !metadata.height ||
    (metadata.pages ?? 1) > 1
  )
    throw new Error("Unsupported image.");
  const result = await sharp(bytes, { limitInputPixels: 80000000 })
    .rotate()
    .toFormat(metadata.format as "png" | "jpeg" | "webp")
    .toBuffer({ resolveWithObject: true });
  return {
    bytes: result.data,
    width: result.info.width,
    height: result.info.height,
    format: metadata.format!,
  };
}
