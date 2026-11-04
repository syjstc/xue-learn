import type {
  GuidedImageAsset,
  GuidedImageIntent,
  GuidedImageSegmentation,
} from "../../../../../../domain/src/guided-image.js";
import type { LlmProviderSelection } from "../../../../providers/llm/index.js";
import { invokeMultimodalStructured } from "../../../../llm/multimodal-structured-native.js";
import { runValidatedStructuredGeneration } from "../../../../llm/validated-structured-generation.js";
import { resolveGuidedImageModelRoute } from "../../../../llm/guided-image-model.js";
import {
  guidedImageNarrationBinding,
  guidedImageSelectionBinding,
  narrationSchema,
  selectionSchema,
  selectionToSegmentation,
} from "./schema.js";

export function guidedImagePrompt(
  intent: GuidedImageIntent,
  correction?: readonly string[],
) {
  return `Create one teaching image for this frozen intent. Do not add unrequested narration or long explanatory paragraphs. Preserve the labels, legends, axes and evidence qualifiers explicitly required by the intent. Short labels must be exactly in ${intent.language}. Depict all required parts and their relationships; use visually distinct, individually recognizable objects. Preserve useful organic silhouettes instead of turning every part into a rectangular card.
For mathematical expressions, treat TeX delimiters as source markup and draw the readable rendered notation rather than literal dollar signs or control commands. Preserve all mathematical symbols, signs, values, units, subscripts and exponents. When the lesson explicitly teaches literal markup or currency, preserve those characters.
Fit the COMPLETE composition and EVERY label inside an 8% safe margin on ALL four sides. Reduce the whole composition if necessary; never crop labels, hands, feet or lower objects. Keep enough vertical room below the bottom row for its labels. Connectors must not cross labels or unrelated objects. Any arrow must follow the exact from -> to direction in relationships; use an undirected connector if it only expresses association.
${JSON.stringify(intent)}${correction?.length ? `\nA previous attempt needs these concrete corrections. If an attached reference image is supplied, edit its incorrect geometry; otherwise draw a corrected replacement. Change actual positions, counts and connector endpoints as needed, not merely their text labels. Keep the complete frozen teaching content and every correct relationship; rearrange the composition when needed for accuracy and readability.\n${JSON.stringify(correction)}` : ""}`;
}

export async function segmentGuidedImage(params: {
  intent: GuidedImageIntent;
  image: GuidedImageAsset;
  dataUrl: string;
  previousImageIssues?: readonly string[];
  selection?: LlmProviderSelection;
  signal: AbortSignal;
}) {
  const route = await resolveGuidedImageModelRoute(params);
  const result = await runValidatedStructuredGeneration(
    {
      mode: "tool-call",
      operation: "unit.learning_material.guided_image.segment",
      schema: selectionSchema(params.intent),
      maxRepairAttempts: 2,
      invoke: ({ validationError, signal }) =>
        invokeMultimodalStructured({
          operation: "unit.learning_material.guided_image.segment",
          prompt: JSON.stringify({
            intent: params.intent,
            image: { width: params.image.width, height: params.image.height },
            ...(params.previousImageIssues?.length ? {
              repairReview: {
                previousFindings: params.previousImageIssues,
                instruction: "Recheck EVERY prior finding against the current pixels. Earlier findings may already be fixed: do not reject a resolved issue or assume that an old issue still exists. Conversely, changed text labels are not evidence that geometry was repaired. Trace the actual start and arrowhead of each cited connector; count the actual drawn cells or objects; compare actual event positions on a shared axis. Report every remaining or regressed substantive contradiction in imageIssues. Also perform the full intent review for new defects. Keep correct relationships and teaching content intact.",
              },
            } : {}),
            ...(validationError ? { correction: validationError } : {}),
          }),
          imageDataUrl: params.dataUrl,
          imageDetail: route.imageDetail,
          schema: guidedImageSelectionBinding,
          bindingName: "segment_guided_image",
          selection: route.selection,
          signal,
          maxTokens: 12_000,
          meta: {
            imageHash: params.image.sha256,
            displayId: params.intent.id,
            previousImageIssueCount: params.previousImageIssues?.length ?? 0,
            imageModelSource: route.source,
          },
        }),
    },
    { signal: params.signal },
  );
  return selectionToSegmentation(result);
}

export async function narrateGuidedImage(params: {
  intent: GuidedImageIntent;
  image: GuidedImageAsset;
  segmentation: GuidedImageSegmentation;
  dataUrl: string;
  personaInstruction: string;
  selection?: LlmProviderSelection;
  signal: AbortSignal;
}) {
  const route = await resolveGuidedImageModelRoute(params);
  const result = await runValidatedStructuredGeneration(
    {
      mode: "tool-call",
      operation: "unit.learning_material.guided_image.narrate",
      schema: narrationSchema(params.intent, params.segmentation),
      maxRepairAttempts: 2,
      invoke: ({ validationError, signal }) =>
        invokeMultimodalStructured({
          operation: "unit.learning_material.guided_image.narrate",
          prompt: [
            params.personaInstruction,
            JSON.stringify({
              intent: params.intent,
              segmentation: params.segmentation,
              ...(validationError ? { correction: validationError } : {}),
            }),
          ].join("\n\n"),
          imageDataUrl: params.dataUrl,
          imageDetail: route.imageDetail,
          schema: guidedImageNarrationBinding,
          bindingName: "narrate_guided_image",
          selection: route.selection,
          signal,
          maxTokens: 10_000,
          meta: {
            imageHash: params.image.sha256,
            displayId: params.intent.id,
            imageModelSource: route.source,
          },
        }),
    },
    { signal: params.signal },
  );
  return result.beats;
}
