import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { hasAigcImageMetadata } from "../aigc/image-label.js";
import { readUnitImage, saveGuidedUnitImage, isValidUnitImageId, unitImageApiPath } from "./storage.js";

let mockImageStorageDir = "";

jest.mock("../env.js", () => ({
  getEnv: () => ({ IMAGE_STORAGE_DIR: mockImageStorageDir }),
  getRuntimeEnvironment: () => ({ XUELEARN_DESKTOP_LOCAL: "0" }),
}));

describe("stored generated image AIGC display", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "xuelearn-aigc-image-"));
    mockImageStorageDir = tempDir;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("labels legacy display bytes while preserving all original variants and hashes across repeated reads", async () => {
    const unitId = "unit-test";
    const imageId = "ill-0-abc123";
    const unitDir = path.join(tempDir, unitId);
    await fs.mkdir(unitDir, { recursive: true });
    const legacy = await sharp({
      create: { width: 600, height: 400, channels: 3, background: "#fff" },
    })
      .png()
      .toBuffer();
    await fs.writeFile(path.join(unitDir, `${imageId}.png`), legacy);

    await fs.writeFile(path.join(unitDir, `${imageId}.jpg`), await sharp(legacy).jpeg().toBuffer());
    await fs.writeFile(path.join(unitDir, `${imageId}.webp`), await sharp(legacy).webp().toBuffer());
    const inventory = async () => Object.fromEntries(await Promise.all((await fs.readdir(unitDir)).sort().map(async name =>
      [name, createHash("sha256").update(await fs.readFile(path.join(unitDir, name))).digest("hex")])));
    const original = await inventory();
    for (let read = 0; read < 2; read++) {
      const displayed = await readUnitImage(unitId, imageId);
      expect(displayed?.mimeType).toBe("image/webp");
      expect(await hasAigcImageMetadata(displayed!.data)).toBe(true);
      expect(displayed!.data.equals(legacy)).toBe(false);
      expect(await inventory()).toEqual(original);
    }
    expect(await hasAigcImageMetadata(await fs.readFile(path.join(unitDir, `${imageId}.png`)))).toBe(false);
  });


  it("keeps labeled guided image pixels, alpha and content hash unchanged on repeated reads", async () => {
    const original = await sharp({ create: { width: 2304, height: 1728, channels: 4, background: { r: 180, g: 90, b: 40, alpha: 0.5 } } }).png().toBuffer();
    const saved = await saveGuidedUnitImage("unit", original);
    expect(isValidUnitImageId(saved.imageId)).toBe(true);
    expect(isValidUnitImageId("ill-guided-../escape")).toBe(false);
    expect(await hasAigcImageMetadata(saved.data)).toBe(true);
    for (let i = 0; i < 2; i++) {
      const read = await readUnitImage("unit", saved.imageId);
      expect(read?.data.equals(saved.data)).toBe(true);
      expect(read?.mimeType).toBe("image/png");
      expect(await sharp(read!.data).metadata()).toMatchObject({ width: 2304, height: 1728, hasAlpha: true });
    }
    const pixels = await sharp(original).raw().toBuffer();
    expect((await sharp(saved.data).raw().toBuffer()).equals(pixels)).toBe(true);
    const again = await saveGuidedUnitImage("unit", original);
    expect(again.sha256).toBe(saved.sha256);
  });

  it("uses the AIGC cache version on image URLs", () => {
    expect(unitImageApiPath("unit", "ill-0-abc", "webp")).toMatch(
      /\?aigc=v1$/,
    );
  });
});
