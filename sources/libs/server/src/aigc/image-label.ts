import sharp from "sharp";
import { serializeAigcMetadata } from "./metadata.js";

export const AIGC_IMAGE_LABEL_VERSION = "1";
export const DEFAULT_AIGC_MAX_DIMENSION = 1024;
export const DESKTOP_2K_AIGC_MAX_DIMENSION = 2848;

export function resolveAigcMaxDimension(customMax?: number): number {
  if (customMax && customMax > 0) return customMax;
  return process.env.XUELEARN_DESKTOP_LOCAL === "1"
    ? DESKTOP_2K_AIGC_MAX_DIMENSION
    : DEFAULT_AIGC_MAX_DIMENSION;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function aigcXmp(contentId: string): string {
  const metadata = escapeXml(serializeAigcMetadata(contentId));
  return `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:xuelearn="https://xue-learn.com/ns/aigc/1.0/" xuelearn:AIGC="${metadata}" xuelearn:AIGCLabelVersion="${AIGC_IMAGE_LABEL_VERSION}" />
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;
}

export async function hasAigcImageMetadata(data: Buffer): Promise<boolean> {
  const metadata = await sharp(data, { failOn: "none" }).metadata();
  return Boolean(
    metadata.xmp?.includes(Buffer.from('xuelearn:AIGCLabelVersion="1"')),
  );
}

/** Immutable image-first assets retain their full pixel canvas and alpha. */
export async function labelAiGeneratedPng(data: Buffer, contentId: string): Promise<Buffer> {
  return sharp(data).withXmp(aigcXmp(contentId)).png().toBuffer();
}

/** Persist AIGC provenance in XMP. Visible notice stays in reading UI, not pixels. */
export async function labelAiGeneratedImage(
  data: Buffer,
  contentId: string,
  options?: { maxDimension?: number },
): Promise<{ data: Buffer; mimeType: "image/webp"; changed: boolean }> {
  if (await hasAigcImageMetadata(data)) {
    return { data, mimeType: "image/webp", changed: false };
  }

  const input = sharp(data, { failOn: "none" }).rotate();
  const metadata = await input.metadata();
  if (!metadata.width || !metadata.height) {
    throw new Error("Cannot label an image without valid dimensions");
  }

  const maxDimension = resolveAigcMaxDimension(options?.maxDimension);
  const scale = Math.min(
    1,
    maxDimension / Math.max(metadata.width, metadata.height),
  );
  const width = Math.max(1, Math.round(metadata.width * scale));
  const height = Math.max(1, Math.round(metadata.height * scale));

  const output = await sharp(data, { failOn: "none" })
    .rotate()
    .resize({
      width,
      height,
      fit: "fill",
      withoutEnlargement: true,
    })
    .withXmp(aigcXmp(contentId))
    .webp({ quality: 82, effort: 4 })
    .toBuffer();

  if (!(await hasAigcImageMetadata(output))) {
    throw new Error("Generated image AIGC metadata verification failed");
  }
  return { data: output, mimeType: "image/webp", changed: true };
}
