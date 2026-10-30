import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

/**
 * A local-only, explicitly staged correction for a single rejected picture.
 * The path includes the exact child-workflow scope and rejected pixel hash.
 * Nothing here mutates a checkpoint: the normal Continue action consumes the
 * candidate as an image-generation result and runs the ordinary pixel review.
 */
export async function readStagedGuidedImageCandidate(input: {
  imageStorageDir: string;
  unitId: string;
  scopeId: string;
  fingerprint: string;
  rejectedSha256: string;
}): Promise<Buffer | undefined> {
  if (!/^[A-Za-z0-9_-]+$/.test(input.unitId) ||
      ![input.scopeId, input.fingerprint, input.rejectedSha256].every(value => /^[a-f0-9]{64}$/.test(value)))
    throw new Error("Invalid staged guided-image candidate identity");
  const dir = path.join(input.imageStorageDir, input.unitId, "guided-repair-candidates");
  const manifestPath = path.join(dir, `${input.scopeId}-${input.rejectedSha256}.json`);
  const manifestData = await readBoundedRegularFile(manifestPath, 4096, true);
  if (!manifestData) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(manifestData.toString("utf8")); }
  catch { throw new Error("Invalid staged guided-image candidate manifest"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Invalid staged guided-image candidate manifest");
  const manifest = parsed as Record<string, unknown>;
  const allowed = ["version", "unitId", "scopeId", "fingerprint", "rejectedSha256", "candidateSha256"];
  if (Object.keys(manifest).length !== allowed.length || Object.keys(manifest).some(key => !allowed.includes(key)) ||
      manifest.version !== 1 || manifest.unitId !== input.unitId || manifest.scopeId !== input.scopeId ||
      manifest.fingerprint !== input.fingerprint || manifest.rejectedSha256 !== input.rejectedSha256 ||
      typeof manifest.candidateSha256 !== "string" || !/^[a-f0-9]{64}$/.test(manifest.candidateSha256))
    throw new Error("Staged guided-image candidate does not match the rejected checkpoint");
  const bytes = await readBoundedRegularFile(path.join(dir, `${manifest.candidateSha256}.png`), 12 * 1024 * 1024, false);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== manifest.candidateSha256)
    throw new Error("Staged guided-image candidate pixels are missing or changed");
  const meta = await sharp(bytes, { limitInputPixels: 24_000_000 }).metadata();
  if (meta.format !== "png" || !meta.width || !meta.height ||
      meta.width < 256 || meta.height < 256 || meta.width > 4096 || meta.height > 4096)
    throw new Error("Staged guided-image candidate must be a bounded PNG");
  return bytes;
}

async function readBoundedRegularFile(file: string, limit: number, optional: boolean) {
  let handle;
  try { handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > limit)
      throw new Error("Invalid staged guided-image candidate file");
    const data = Buffer.allocUnsafe(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const result = await handle.read(data, offset, data.length - offset, offset);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const extra = await handle.read(Buffer.allocUnsafe(1), 0, 1, offset);
    if (offset !== stat.size || extra.bytesRead !== 0)
      throw new Error("Staged guided-image candidate changed while reading");
    return data;
  } finally { await handle.close(); }
}
