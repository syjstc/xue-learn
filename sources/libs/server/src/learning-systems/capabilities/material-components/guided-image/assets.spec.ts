import sharp from "sharp";
import { IMAGE_DESIGN_TOKENS } from "../../../../images/design-style.js";
import { guidedImageObservationDataUrl, imageSha256 } from "./assets.js";

it("observes transparent pixels against the classroom matte without changing the source or its geometry", async () => {
  const original = await sharp(Buffer.from([0, 0, 0, 255, 0, 0, 0, 0]), {
    raw: { width: 2, height: 1, channels: 4 },
  }).png().toBuffer();
  const hash = imageSha256(original);
  const url = await guidedImageObservationDataUrl(original);
  const observed = Buffer.from(url.split(",")[1], "base64");
  const { data, info } = await sharp(observed).raw().toBuffer({ resolveWithObject: true });
  expect(info).toMatchObject({ width: 2, height: 1, channels: 3 });
  expect([...data]).toEqual([0, 0, 0, 237, 231, 224]);
  expect(imageSha256(original)).toBe(hash);
  expect((await sharp(original).metadata()).hasAlpha).toBe(true);
  expect(IMAGE_DESIGN_TOKENS.surfaceInset).toBe("#EDE7E0");
});
