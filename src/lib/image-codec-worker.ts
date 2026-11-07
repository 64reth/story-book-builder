import { imageSize } from "image-size";
export async function canonicalImage(bytes: Buffer) {
  const meta = imageSize(bytes);
  const format = meta.type === "jpg" ? "jpeg" : meta.type;
  if (
    !["png", "jpeg", "webp"].includes(format ?? "") ||
    !meta.width ||
    !meta.height ||
    meta.width * meta.height > 80000000
  )
    throw new Error(
      "Unsupported image or image dimensions exceed the safe limit.",
    );
  if (
    format === "png" &&
    (!bytes.subarray(-8, -4).equals(Buffer.from("IEND")) ||
      bytes.includes(Buffer.from("acTL")))
  )
    throw new Error("Upload a complete, single-frame PNG.");
  if (format === "jpeg" && !bytes.subarray(-2).equals(Buffer.from([255, 217])))
    throw new Error("Upload a complete JPEG.");
  if (
    format === "webp" &&
    (bytes.includes(Buffer.from("ANIM")) ||
      bytes.readUInt32LE(4) + 8 !== bytes.length)
  )
    throw new Error("Upload a complete single-frame WebP.");
  // Store original bytes in R2. Browsers/Canva decode the original artwork;
  // native libvips is intentionally confined to the local adapter.
  return { bytes, width: meta.width, height: meta.height, format: format! };
}
