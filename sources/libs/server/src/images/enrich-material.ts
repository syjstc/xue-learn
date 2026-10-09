import { randomUUID } from "node:crypto";
import { GenerationCancelledError } from "../generation/errors.js";
import type {
  LearningMaterialContent,
  InteractiveBlock,
} from "../llm/schemas.js";
import {
  getPromptLanguageLabel,
  type ContentLanguageCode,
} from "../llm/content-language.js";
import { beginLlmRequestLog } from "../llm/logger.js";
import { assertImageGenerationConfigured } from "./availability.js";
import { getImageProvider, isImageGenerationAvailable } from "./providers/index.js";
import {
  ensureImageRuntimeConfig,
  getImageRuntimeConfig,
} from "./runtime-config.js";
import {
  formatCourseSvgIntent,
  type CourseSvgVisualKind,
} from "../llm/course-svg-intent.js";
import { imageStorageId, saveUnitImage, unitImageApiPath } from "./storage.js";
import type { GenerateImageInput } from "./providers/types.js";
import type { ImageProvider } from "../providers/image/types.js";
import { removeDesktopOpaqueBackground } from "./desktop-background-removal.js";

export async function generateMaterialImage(
  provider: ImageProvider,
  input: GenerateImageInput,
) {
  const result = await provider.generateImage(input);
  if (process.env.XUELEARN_DESKTOP_LOCAL !== "1") return result;

  const normalized = await removeDesktopOpaqueBackground(
    result.data,
    result.mimeType,
    () => input.onProgress?.({ stage: "removing_background" }),
  );
  return {
    ...result,
    data: normalized.data,
    mimeType: normalized.mimeType,
    meta: {
      ...result.meta,
      transparent: true,
      desktopBackgroundRemoval: normalized.wasAlreadyTransparent
        ? "not_needed"
        : "edge_flat",
      desktopBackgroundRemovedPixels: normalized.removedPixels,
    },
  };
}

export function illustrationPromptBlock(
  contentLanguage: ContentLanguageCode,
): string {
  if (!isImageGenerationAvailable()) {
    return `
Illustrations:
- Image generation is disabled in settings. Do NOT add "illustration" blocks. Use svg_slot or another matching board instead.`;
  }
  const langLabel = getPromptLanguageLabel(contentLanguage);
  return `
Illustrations (when a raster picture is the teaching object):
- Display types are peers. Use an illustration when the learner should see a raster picture (process, anatomy, architecture, timeline, realistic scene). Use svg_slot or another board when that is the matching object. Do not add decorative pictures.
- Each illustration needs:
  - caption: short learner-facing description (${langLabel}, same as main content)
  - prompt: detailed image-generation prompt in English describing layout and visual elements; include a "Labels:" line listing every on-image label exactly as it should appear, written in ${langLabel} (must match caption and surrounding content language)
  - The renderer already pins the fixed product art style (transparent background with the warm light-theme palette, flat educational vector look, fixed colors). Do NOT specify colors, backgrounds, frames, lighting, or art style in the prompt; describe only subject, layout, elements, relationships, and labels.
  - style: one of diagram | process | concept | comparison
  - aspectRatio (optional): 16:9 | 4:3 | 1:1
- Place each illustration right after the paragraph that introduces the concept.`;
}

export function materialBlockTypesLine(): string {
  const base = "headings, paragraphs, callouts, accordions, compare panels";
  if (isImageGenerationAvailable()) {
    return `${base}, and illustrations when appropriate`;
  }
  return base;
}

export function stripIllustrationBlocksIfDisabled(
  material: LearningMaterialContent,
): LearningMaterialContent {
  // Keep illustration placeholders when 配图 is off so heading → display →
  // narration still publishes. Raster generation can run later.
  return material;
}

export type ImageEnrichProgress = {
  current: number;
  total: number;
  caption: string;
};

const IMAGE_GENERATION_CONCURRENCY = 3;

type IllustrationJob = {
  blockIndex: number;
  block: Extract<InteractiveBlock, { type: "illustration" }>;
};

function countIllustrationsToGenerate(
  material: LearningMaterialContent,
  maxImages: number,
): number {
  let count = 0;
  let generated = 0;
  for (const block of material.blocks) {
    if (block.type !== "illustration") continue;
    if (generated >= maxImages) break;
    if (block.imageUrl) continue;
    count += 1;
    generated += 1;
  }
  return count;
}

export async function enrichMaterialWithImages(
  material: LearningMaterialContent,
  unitId: string,
  meta?: {
    goalId?: string;
    unitTitle?: string;
    contentLanguage?: ContentLanguageCode;
    /**
     * Salt image object ids per authoritative material generation. This keeps a
     * stale generation from overwriting the blob referenced by a newer one even
     * when both generations authored the same prompt at the same block index.
     */
    storageRevision?: string;
  },
  options?: {
    onStart?: (total: number) => void | Promise<void>;
    onProgress?: (progress: ImageEnrichProgress) => void | Promise<void>;
    onImageReady?: (info: {
      blockIndex: number;
      block: Extract<InteractiveBlock, { type: "illustration" }>;
    }) => void | Promise<void>;
    signal?: AbortSignal;
  },
): Promise<LearningMaterialContent> {
  await ensureImageRuntimeConfig();
  if (!isImageGenerationAvailable()) return material;

  const imageProvider = getImageProvider();
  if (!imageProvider) return material;
  const provider = imageProvider;

  const maxImages =
    process.env.XUELEARN_DESKTOP_DEV === "1"
      ? Math.max(12, getImageRuntimeConfig().maxIllustrations)
      : getImageRuntimeConfig().maxIllustrations;
  const storageRevision = meta?.storageRevision?.trim() || randomUUID();
  const jobs: IllustrationJob[] = [];
  let generated = 0;

  for (let i = 0; i < material.blocks.length; i++) {
    const block = material.blocks[i]!;
    if (block.type !== "illustration" || generated >= maxImages) continue;
    if (block.imageUrl) continue;
    jobs.push({ blockIndex: i, block });
    generated += 1;
  }

  const totalToGenerate = jobs.length;
  if (totalToGenerate > 0) {
    await options?.onStart?.(totalToGenerate);
  }

  const generatedBlocks = new Map<number, InteractiveBlock>();
  let progressIndex = 0;
  let jobCursor = 0;

  async function generateIllustration(job: IllustrationJob) {
    if (options?.signal?.aborted) {
      throw new GenerationCancelledError();
    }

    progressIndex += 1;
    await options?.onProgress?.({
      current: progressIndex,
      total: totalToGenerate,
      caption: job.block.caption,
    });

    const started = Date.now();
    const logHandle = await beginLlmRequestLog({
      operation: "unit.illustration",
      kind: "image",
      request: {
        blockIndex: job.blockIndex,
        caption: job.block.caption,
        prompt: job.block.prompt,
        style: job.block.style,
        aspectRatio: job.block.aspectRatio,
      },
      meta: { goalId: meta?.goalId, unitTitle: meta?.unitTitle, unitId },
    });
    const isDesktopLocal = process.env.XUELEARN_DESKTOP_LOCAL === "1";
    try {
      const result = await generateMaterialImage(provider, {
        prompt: job.block.prompt,
        style: job.block.style,
        aspectRatio: job.block.aspectRatio,
        labelLanguage: meta?.contentLanguage,
        compact: !isDesktopLocal,
        resolution: isDesktopLocal ? "2k" : "1k",
      });
      const imageId = imageStorageId(
        unitId,
        job.blockIndex,
        job.block.prompt,
        storageRevision,
      );
      const { ext } = await saveUnitImage(
        unitId,
        imageId,
        result.data,
        result.mimeType,
      );
      const imageUrl = unitImageApiPath(unitId, imageId, ext);

      await logHandle?.finish({
        status: "success",
        durationMs: Date.now() - started,
        response: { imageUrl, imageId, ...result.meta },
      });

      const updatedBlock = {
        ...job.block,
        imageId,
        imageUrl,
      };
      generatedBlocks.set(job.blockIndex, updatedBlock);
      await options?.onImageReady?.({
        blockIndex: job.blockIndex,
        block: updatedBlock,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await logHandle?.finish({
        status: "success",
        durationMs: Date.now() - started,
        response: {
          imageSkipped: true,
          reason: message,
        },
      });
      generatedBlocks.set(job.blockIndex, job.block);
    }
  }

  async function worker() {
    while (jobCursor < jobs.length) {
      const job = jobs[jobCursor]!;
      jobCursor += 1;
      await generateIllustration(job);
    }
  }

  if (jobs.length > 0) {
    await Promise.all(
      Array.from(
        { length: Math.min(IMAGE_GENERATION_CONCURRENCY, jobs.length) },
        () => worker(),
      ),
    );
  }

  const blocks = material.blocks.map(
    (block, index) => generatedBlocks.get(index) ?? block,
  );

  return { ...material, blocks };
}

type IllustrationBlock = Extract<InteractiveBlock, { type: "illustration" }>;
type SvgBlock = Extract<InteractiveBlock, { type: "svg" }>;

function illustrationStyleFromVisualKind(
  visualKind: CourseSvgVisualKind | undefined,
): IllustrationBlock["style"] {
  if (visualKind === "state_comparison") return "comparison";
  if (visualKind === "step_derivation" || visualKind === "simple_structure") {
    return "process";
  }
  return "diagram";
}

/** Build a raster illustration prompt from a compiled teaching SVG. */
export function illustrationFromSvgBlock(
  block: SvgBlock,
  contentLanguage: ContentLanguageCode,
): IllustrationBlock {
  const caption = block.caption.trim();
  const title = block.title?.trim() || block.alt.trim();
  const labels = block.intent?.labels?.filter(Boolean) ?? [];
  const langLabel = getPromptLanguageLabel(contentLanguage);
  const brief = block.intent
    ? formatCourseSvgIntent(block.intent)
    : `Setup: ${block.alt.trim()}`;
  const labelsLine = labels.length
    ? `Labels: ${labels.join(" | ")}`
    : `Labels: short ${langLabel} labels that match the caption "${caption}"`;
  return {
    type: "illustration",
    caption,
    prompt: [
      "Clean educational teaching illustration of the same picture, not a screenshot of SVG markup.",
      "High-contrast schematic, readable labels, no decorative clutter.",
      `Isolated subject on a fully transparent background (PNG alpha), full-bleed 16:9, no outer white card, paper fill, or drop shadow, no AI watermark badge.`,
      `Semantic subject (do not render as an on-image title): ${title}`,
      brief,
      labelsLine,
    ].join("\n"),
    style: illustrationStyleFromVisualKind(block.intent?.visualKind),
    aspectRatio: "16:9",
  };
}

export async function replaceSvgBlockWithIllustration(
  material: LearningMaterialContent,
  unitId: string,
  blockIndex: number,
  meta?: {
    goalId?: string;
    unitTitle?: string;
    contentLanguage?: ContentLanguageCode;
  },
  options?: {
    onProgress?: GenerateImageInput["onProgress"];
  },
): Promise<{
  material: LearningMaterialContent;
  block: IllustrationBlock;
}> {
  await ensureImageRuntimeConfig();
  assertImageGenerationConfigured();

  const provider = getImageProvider();
  if (!provider) {
    throw new Error("Image generation provider could not be initialized");
  }

  const current = material.blocks[blockIndex];
  if (!current || current.type !== "svg") {
    throw new Error("Block is not an svg diagram");
  }

  const contentLanguage = meta?.contentLanguage ?? "zh-Hans";
  const drafted = illustrationFromSvgBlock(current, contentLanguage);
  const revision = Date.now().toString(36);
  const started = Date.now();
  const logHandle = await beginLlmRequestLog({
    operation: "unit.illustration.from_svg",
    kind: "image",
    request: {
      blockIndex,
      caption: drafted.caption,
      prompt: drafted.prompt,
      style: drafted.style,
      aspectRatio: drafted.aspectRatio,
      revision,
    },
    meta: { goalId: meta?.goalId, unitTitle: meta?.unitTitle, unitId },
  });

  const isDesktopLocal = process.env.XUELEARN_DESKTOP_LOCAL === "1";
  try {
    const result = await generateMaterialImage(provider, {
      prompt: drafted.prompt,
      style: drafted.style,
      aspectRatio: drafted.aspectRatio,
      labelLanguage: contentLanguage,
      compact: !isDesktopLocal,
      resolution: isDesktopLocal ? "2k" : "1k",
      onProgress: options?.onProgress,
    });
    const imageId = imageStorageId(
      unitId,
      blockIndex,
      drafted.prompt,
      revision,
    );
    const { ext } = await saveUnitImage(
      unitId,
      imageId,
      result.data,
      result.mimeType,
    );
    const imageUrl = unitImageApiPath(unitId, imageId, ext);
    const updatedBlock = { ...drafted, imageId, imageUrl };

    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: { imageUrl, imageId, ...result.meta },
    });

    const blocks = [...material.blocks];
    blocks[blockIndex] = updatedBlock;
    return { material: { ...material, blocks }, block: updatedBlock };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    throw err;
  }
}

export async function regenerateIllustrationBlock(
  material: LearningMaterialContent,
  unitId: string,
  blockIndex: number,
  meta?: {
    goalId?: string;
    unitTitle?: string;
    contentLanguage?: ContentLanguageCode;
  },
  options?: {
    prompt?: string;
    onProgress?: GenerateImageInput["onProgress"];
  },
): Promise<{
  material: LearningMaterialContent;
  block: Extract<InteractiveBlock, { type: "illustration" }>;
}> {
  await ensureImageRuntimeConfig();
  assertImageGenerationConfigured();

  const provider = getImageProvider();
  if (!provider) {
    throw new Error("Image generation provider could not be initialized");
  }

  const block = material.blocks[blockIndex];
  if (!block || block.type !== "illustration") {
    throw new Error("Block is not an illustration");
  }

  if (block.guidedImage) {
    throw new Error("这张图的区域和讲解绑定在一起，请使用重新生成本主题，重新生成图片、区域和讲解。");
  }
  const effectivePrompt = options?.prompt?.trim() || block.prompt;
  const revision = Date.now().toString(36);
  const started = Date.now();
  const logHandle = await beginLlmRequestLog({
    operation: "unit.illustration.regenerate",
    kind: "image",
    request: {
      blockIndex,
      caption: block.caption,
      prompt: effectivePrompt,
      style: block.style,
      aspectRatio: block.aspectRatio,
      revision,
    },
    meta: { goalId: meta?.goalId, unitTitle: meta?.unitTitle, unitId },
  });

  const isDesktopLocal = process.env.XUELEARN_DESKTOP_LOCAL === "1";
  try {
    const result = await generateMaterialImage(provider, {
      prompt: effectivePrompt,
      style: block.style,
      aspectRatio: block.aspectRatio,
      labelLanguage: meta?.contentLanguage,
      compact: !isDesktopLocal,
      resolution: isDesktopLocal ? "2k" : "1k",
      onProgress: options?.onProgress,
    });
    const imageId = imageStorageId(
      unitId,
      blockIndex,
      effectivePrompt,
      revision,
    );
    const { ext } = await saveUnitImage(
      unitId,
      imageId,
      result.data,
      result.mimeType,
    );
    const imageUrl = unitImageApiPath(unitId, imageId, ext);
    const updatedBlock = {
      ...block,
      prompt: effectivePrompt,
      imageId,
      imageUrl,
    };

    await logHandle?.finish({
      status: "success",
      durationMs: Date.now() - started,
      response: { imageUrl, imageId, ...result.meta },
    });

    const blocks = [...material.blocks];
    blocks[blockIndex] = updatedBlock;
    return { material: { ...material, blocks }, block: updatedBlock };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await logHandle?.finish({
      status: "error",
      durationMs: Date.now() - started,
      error: message,
    });
    throw err;
  }
}
