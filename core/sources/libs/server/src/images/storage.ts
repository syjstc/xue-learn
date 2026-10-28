import { getRuntimeEnvironment } from "../env.js";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import { getEnv } from "../env.js";
import {
  compressImageBuffer,
  STORED_IMAGE_OPTIONS,
  STORED_2K_IMAGE_OPTIONS,
  type CompressImageOptions,
} from "./compress-image.js";
import { labelAiGeneratedImage, labelAiGeneratedPng } from "../aigc/image-label.js";

const IMAGE_EXTENSIONS = ["png", "jpg", "webp"] as const;

function unitImagesDir(unitId: string): string {
  const base = getEnv().IMAGE_STORAGE_DIR;
  return path.join(base, unitId);
}

export function imageStorageId(
  unitId: string,
  blockIndex: number,
  prompt: string,
  revision?: string,
): string {
  const hash = createHash("sha256")
    .update(`${unitId}:${blockIndex}:${prompt}:${revision ?? "0"}`)
    .digest("hex")
    .slice(0, 16);
  return `ill-${blockIndex}-${hash}`;
}

/** Matches material illustration ids (`ill-0-abc…`). */
export function isValidUnitImageId(imageId: string): boolean {
  return /^ill-(?:\d+-[a-f0-9]+|guided-[a-f0-9]{64})$/.test(imageId);
}

/** Content-addressed, labeled PNG. Readers must never recompress these assets:
 * their segmentation and narration are bound to this exact frozen image. */
export async function saveGuidedUnitImage(unitId: string, input: Buffer) {
  const contentId = createHash("sha256").update(input).digest("hex");
  const data = await labelAiGeneratedPng(input, contentId);
  const sha256 = createHash("sha256").update(data).digest("hex");
  const imageId = `ill-guided-${sha256}`;
  const dir = unitImagesDir(unitId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${imageId}.png`), data, { flag: "wx" }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  return { imageId, sha256, src: unitImageApiPath(unitId, imageId, "png"), data };
}

/** Adopt accepted pixels without compression or relabeling: diagram regions
 * and saved film frames are bound to these exact bytes. */
export async function adoptUnitImage(unitId: string, input: {imageId: string; data: Buffer; mimeType: string; sha256: string}) {
  if (!/^[A-Za-z0-9_-]+$/.test(unitId) || !isValidUnitImageId(input.imageId)
    || !['image/png', 'image/jpeg', 'image/webp'].includes(input.mimeType)
    || createHash('sha256').update(input.data).digest('hex') !== input.sha256) throw Error('Invalid accepted course image');
  const previous = await readRawUnitImage(unitId, input.imageId);
  if (previous) {
    if (createHash('sha256').update(previous.data).digest('hex') !== input.sha256 || previous.mimeType !== input.mimeType)
      throw Error('An immutable course image already has different bytes');
    return;
  }
  const dir = unitImagesDir(unitId);
  await fs.mkdir(dir, {recursive: true});
  await fs.writeFile(path.join(dir, `${input.imageId}.${imageFileExtension(input.mimeType)}`), input.data, {flag: 'wx'}).catch(async error => {
    if (error.code !== 'EEXIST') throw error;
    const current = await readRawUnitImage(unitId, input.imageId);
    if (!current || createHash('sha256').update(current.data).digest('hex') !== input.sha256) throw Error('Course image changed during adoption');
  });
}

export function imageFileExtension(mimeType: string): string {
  if (mimeType.includes("jpeg") || mimeType.includes("jpg")) return "jpg";
  if (mimeType.includes("webp")) return "webp";
  return "png";
}

function mimeTypeForExtension(ext: (typeof IMAGE_EXTENSIONS)[number]): string {
  if (ext === "jpg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "image/png";
}

async function removeStaleImageVariants(
  dir: string,
  imageId: string,
  keepExt: string,
): Promise<void> {
  await Promise.all(
    IMAGE_EXTENSIONS.filter((ext) => ext !== keepExt).map((ext) =>
      fs.unlink(path.join(dir, `${imageId}.${ext}`)).catch(() => undefined),
    ),
  );
}

function storedUnitImageOptions(): CompressImageOptions {
  return getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1"
    ? STORED_2K_IMAGE_OPTIONS
    : STORED_IMAGE_OPTIONS;
}

async function persistCompressedUnitImage(
  dir: string,
  imageId: string,
  data: Buffer,
  mimeType: string,
): Promise<{ data: Buffer; mimeType: string; ext: string }> {
  const options = storedUnitImageOptions();
  const compressed = await compressImageBuffer(
    data,
    mimeType,
    options,
  );
  const labeled = await labelAiGeneratedImage(compressed.data, imageId, {
    maxDimension: options.maxDimension,
  });
  const ext = imageFileExtension(labeled.mimeType);
  await fs.writeFile(path.join(dir, `${imageId}.${ext}`), labeled.data);
  await removeStaleImageVariants(dir, imageId, ext);
  return { data: labeled.data, mimeType: labeled.mimeType, ext };
}

export async function saveUnitImage(
  unitId: string,
  imageId: string,
  data: Buffer,
  mimeType: string,
): Promise<{ imageId: string; ext: string }> {
  const dir = unitImagesDir(unitId);
  await fs.mkdir(dir, { recursive: true });
  const stored = await persistCompressedUnitImage(dir, imageId, data, mimeType);
  return { imageId, ext: stored.ext };
}

export async function readUnitImage(
  unitId: string,
  imageId: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const dir = unitImagesDir(unitId);
  const options = storedUnitImageOptions();
  for (const ext of IMAGE_EXTENSIONS) {
    const filePath = path.join(dir, `${imageId}.${ext}`);
    try {
      const data = await fs.readFile(filePath);
      const mimeType = mimeTypeForExtension(ext);
      if (/^ill-guided-[a-f0-9]{64}$/.test(imageId)) {
        if (ext !== "png" || createHash("sha256").update(data).digest("hex") !== imageId.slice(11)) {
          throw new Error("Guided image fingerprint mismatch");
        }
        return { data, mimeType };
      }
      const compressed = await compressImageBuffer(
        data,
        mimeType,
        options,
      );
      const labeled = await labelAiGeneratedImage(compressed.data, imageId, {
        maxDimension: options.maxDimension,
      });
      // Reading a legacy image may prepare labeled display bytes, but accepted
      // on-disk pixels and every historical filename remain immutable.
      return labeled;
    } catch {
      // try next extension
    }
  }
  return null;
}

/** Public API path served by Next route */
export function unitImageApiPath(
  unitId: string,
  imageId: string,
  ext: string,
): string {
  return `/api/units/${unitId}/images/${imageId}.${ext}?aigc=v1`;
}

/** Export source bytes without compression, labeling, writes, or variant cleanup. */
export async function readRawUnitImage(unitId: string, imageId: string): Promise<{data: Buffer; mimeType: string} | null> {
  if (!/^[A-Za-z0-9_-]+$/.test(unitId) || !isValidUnitImageId(imageId)) return null;
  for (const ext of IMAGE_EXTENSIONS) {
    try {
      const data = await fs.readFile(path.join(unitImagesDir(unitId), `${imageId}.${ext}`));
      if (/^ill-guided-[a-f0-9]{64}$/.test(imageId) &&
        (ext !== "png" || createHash("sha256").update(data).digest("hex") !== imageId.slice(11)))
        throw new Error("Guided image fingerprint mismatch");
      return {data, mimeType: mimeTypeForExtension(ext)};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return null;
}
