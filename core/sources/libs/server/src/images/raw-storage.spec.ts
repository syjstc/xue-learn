import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
let mockAssetRoot: string;
jest.mock("../env.js", () => ({getEnv: () => ({IMAGE_STORAGE_DIR: mockAssetRoot})}));
jest.mock("./compress-image.js", () => ({compressImageBuffer: jest.fn(() => {throw new Error("Source read must never compress");}), STORED_IMAGE_OPTIONS: {}, STORED_2K_IMAGE_OPTIONS: {}}));
jest.mock("../aigc/image-label.js", () => ({labelAiGeneratedImage: jest.fn(() => {throw new Error("Source read must never label");}), labelAiGeneratedPng: jest.fn()}));
import { readRawUnitImage } from "./storage.js";

beforeEach(async () => { mockAssetRoot = await mkdtemp(join(tmpdir(), "raw-course-asset-")); await mkdir(join(mockAssetRoot, "unit")); });
afterEach(async () => rm(mockAssetRoot, {recursive: true, force: true}));
it("returns exact original bytes without compression, labeling or persisted changes", async () => {
  const bytes = Buffer.from("exact saved original raster bytes");
  const file = join(mockAssetRoot, "unit", "ill-0-abc.png");
  await writeFile(file, bytes);
  expect(await readRawUnitImage("unit", "ill-0-abc")).toEqual({data: bytes, mimeType: "image/png"});
  expect(await readFile(file)).toEqual(bytes);
  expect(await readRawUnitImage("../unit", "ill-0-abc")).toBeNull();
});
it("checks immutable guided image hashes and never substitutes a changed candidate", async () => {
  const bytes = Buffer.from("immutable accepted pixels");
  const id = `ill-guided-${createHash("sha256").update(bytes).digest("hex")}`;
  const file = join(mockAssetRoot, "unit", `${id}.png`);
  await writeFile(file, bytes);
  expect((await readRawUnitImage("unit", id))?.data).toEqual(bytes);
  await writeFile(file, Buffer.from("changed pixels"));
  await expect(readRawUnitImage("unit", id)).rejects.toThrow("fingerprint mismatch");
});
