import type { ContentLanguageCode } from "../../llm/content-language.js";
import type { ActiveImageProviderId } from "./ids.js";
import type { ProviderSelection } from "../core/types.js";

export type ImageAspectRatio =
  "1:1" | "16:9" | "4:3" | "3:2" | "2:3" | "3:4" | "9:16";

export type GenerateImageInput = {
  prompt: string;
  /** Exact owned pixels to edit; callers must check supportsImageEditing first. */
  referenceImage?: {data: Buffer; mimeType: "image/png" | "image/jpeg" | "image/webp"};
  signal?: AbortSignal;
  aspectRatio?: ImageAspectRatio;
  /** Educational hint for prompt wrapping */
  style?: "diagram" | "process" | "concept" | "comparison";
  /** Goal content language — constrains on-image label text */
  labelLanguage?: ContentLanguageCode;
  /** Scene illustrations: no words, labels, or numbers on the image */
  noText?: boolean;
  /** Preserve explicitly requested teaching text, including titles and evidence qualifiers. */
  textPolicy?: "preserve-intent";
  /** Smaller output (~512px short edge) while preserving aspect ratio (lower cost). */
  compact?: boolean;
  /** Requested resolution tier (e.g. "2k" for desktop-local high quality vs "1k" / compact for hosted). */
  resolution?: "1k" | "2k";
  /**
   * Best-effort provider progress. A preview URL may be short-lived and must
   * not be persisted as the authoritative image URL.
   */
  onProgress?: (progress: {
    stage: "requesting" | "generating" | "downloading" | "removing_background";
    previewUrl?: string;
  }) => void | Promise<void>;
};

export type GenerateImageResult = {
  /** Raw image bytes */
  data: Buffer;
  mimeType: string;
  /** Provider-specific metadata for logging */
  meta?: Record<string, unknown>;
};

export type ImageProvider = {
  id: ActiveImageProviderId;
  model: string;
  supportsImageEditing?: boolean;
  generateImage(input: GenerateImageInput): Promise<GenerateImageResult>;
};

/** Per-vendor image options (extend per vendor as needed). */
export type ImageProviderOptions = Record<string, never>;

export type ImageProviderSelection = ProviderSelection<
  ActiveImageProviderId,
  ImageProviderOptions
>;
