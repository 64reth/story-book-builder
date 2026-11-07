import { artworkBucket } from "@/lib/platform";
import { uploadRoot } from "./storage";
import path from "node:path";
import { readFile, writeFile, stat, unlink } from "node:fs/promises";
function key(filename: string) {
  if (!/^[a-f0-9-]+\.(png|jpeg|webp)$/.test(filename))
    throw new Error("Invalid artwork key.");
  return filename;
}
export async function writeArtwork(
  filename: string,
  bytes: Uint8Array,
  mime: string,
) {
  const bucket = artworkBucket();
  if (bucket)
    await bucket.put(key(filename), bytes, {
      httpMetadata: { contentType: mime },
    });
  else
    await writeFile(path.join(uploadRoot(), key(filename)), bytes, {
      flag: "wx",
    });
}
export async function readArtwork(filename: string) {
  const bucket = artworkBucket();
  if (bucket) {
    const obj = await bucket.get(key(filename));
    if (!obj) throw new Error("Artwork not found.");
    return Buffer.from(await obj.arrayBuffer());
  }
  return readFile(path.join(uploadRoot(), key(filename)));
}
export async function artworkSize(filename: string) {
  const bucket = artworkBucket();
  if (bucket) {
    const obj = await bucket.head(key(filename));
    if (!obj) throw new Error("Artwork not found.");
    return obj.size;
  }
  const meta = await stat(path.join(uploadRoot(), key(filename)));
  if (!meta.isFile()) throw new Error("Not an artwork file.");
  return meta.size;
}
export async function deleteArtwork(filename: string) {
  const bucket = artworkBucket();
  if (bucket) await bucket.delete(key(filename));
  else
    await unlink(path.join(uploadRoot(), key(filename))).catch(
      (e: NodeJS.ErrnoException) => {
        if (e.code !== "ENOENT") throw e;
      },
    );
}
