import {
  getImageLabelLanguageInstruction,
  type ContentLanguageCode,
} from "../llm/content-language.js";
import type { GenerateImageInput } from "./providers/types.js";
import { imageStyleContract } from "./design-style.js";

export function appendLabelLanguageToPrompt(
  prompt: string,
  labelLanguage?: ContentLanguageCode,
): string {
  if (!labelLanguage) return prompt.trim();
  return `${prompt.trim()}\n\n${getImageLabelLanguageInstruction(labelLanguage)}`;
}

const STYLE_HINTS: Record<NonNullable<GenerateImageInput["style"]>, string> = {
  diagram: "educational diagram",
  process: "process flow infographic",
  concept: "concept illustration",
  comparison: "comparison diagram",
};

const TYPOGRAPHY_HINT =
  "For essential on-image labels, use clean modern sans-serif typography matching Noto Sans SC / PingFang SC for Chinese and Plus Jakarta Sans for Latin text. Use regular or semibold weight only; never use handwriting, brush calligraphy, decorative display lettering, serif text, outlines, or faux bold.";

export function wrapImageGenerationPrompt(
  input: GenerateImageInput,
  options?: { transparent?: boolean },
): string {
  const style = imageStyleContract({
    noText: input.noText,
    transparent: options?.transparent,
  });
  if (input.noText) {
    const styleHint = input.style ? `${STYLE_HINTS[input.style]}, ` : "";
    return `${input.prompt.trim()}. ${styleHint}Simple object or icon illustration only: absolutely no text, labels, words, letters, or numbers on the image. Clean flat illustration, soft colors. ${style}`;
  }

  const label = input.style
    ? (STYLE_HINTS[input.style] ?? "educational illustration")
    : "educational illustration";
  const textPolicy = input.textPolicy === "preserve-intent"
    ? "Preserve every explicitly requested teaching label, axis name, legend, checkpoint letter, title and evidence qualifier in the supplied intent. Do not add unrequested text or explanatory paragraphs. If the intent requests no text, keep it text-free."
    : "Do not render a title, subtitle, caption, or explanatory paragraph inside the image; keep text to short labels only.";
  const quality = input.textPolicy === "preserve-intent" ? "Clean, textbook-quality." : "Clean, labeled, textbook-quality.";
  const base = `${label}: ${input.prompt.trim()}. ${quality} ${TYPOGRAPHY_HINT} ${textPolicy} ${style}`;
  return appendLabelLanguageToPrompt(base, input.labelLanguage);
}
