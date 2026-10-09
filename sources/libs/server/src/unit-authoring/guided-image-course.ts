import { createHash } from "node:crypto";
import { requireAgentConversationPersistence } from "../agents/core/checkpoint.js";
import { ensureImageRuntimeConfig } from "../images/runtime-config.js";
import { assertImageGenerationConfigured } from "../images/availability.js";
import { getImageProvider } from "../providers/image/resolve.js";
import {
  readUnitImage,
  saveGuidedUnitImage,
} from "../images/storage.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { getBuiltinTeachingPersona } from "../teaching-personas/index.js";
import { formatTeachingPersonaPromptPart } from "../teaching-personas/prompt.js";
import { guidedImageDisplaySchema } from "../learning-systems/capabilities/material-components/guided-image/schema.js";
import {
  runGuidedImageDisplay,
  guidedImageFingerprint,
  type GuidedImageCheckpoint,
} from "../learning-systems/capabilities/material-components/guided-image/runner.js";
import {
  imageSha256,
  normalizeGuidedImage,
  cutGuidedImageRegion,
} from "../learning-systems/capabilities/material-components/guided-image/assets.js";
import {
  guidedImagePrompt,
  segmentGuidedImage,
  narrateGuidedImage,
} from "../learning-systems/capabilities/material-components/guided-image/provider.js";
import type {
  GuidedImageAsset,
  GuidedImageIntent,
} from "../../../domain/src/guided-image.js";
import { beginLlmRequestLog } from "../llm/logger.js";
import {
  getLlmTrace,
  runWithLlmTraceAsync,
} from "../llm/trace-context.js";
import { sanitizeBackendErrorText } from "../observability/backend-error-log.js";

/** Owned child state lives behind the shared conversation port. No learner
 * session, grading/evidence, or second persistence implementation is involved. */
type CourseGuidedImageInput = {
  userId: string;
  goalId: string;
  unitId: string;
  sectionId: string;
  revisionId: string;
  intent: GuidedImageIntent;
  personaRef: string;
  signal?: AbortSignal;
  onProgress?: (phase: string) => void | Promise<void>;
};

export async function generateCourseGuidedImage(input: CourseGuidedImageInput) {
  return runWithLlmTraceAsync(
    {
      traceId: getLlmTrace()?.traceId,
      meta: {
        goalId: input.goalId,
        scope: "unit",
        scopeId: input.unitId,
        unitId: input.unitId,
        sectionId: input.sectionId,
      },
    },
    async () => {
      // Provider calls are only part of this child: image storage, region cuts
      // and final validation can fail after every language-model call succeeded.
      // Keep each attempt in the log even when a retry replaces its checkpoint.
      const started = Date.now();
      let phase = "initialization";
      const log = await beginLlmRequestLog({
        operation: "unit.learning_material.guided_image",
        kind: "image",
        spanType: "tool",
        toolName: "guided_image_display",
        label: "图片讲解生成",
        setActiveSpan: true,
        request: {
          sectionId: input.sectionId,
          revisionId: input.revisionId,
          displayId: input.intent.id,
          title: input.intent.title,
        },
      });
      try {
        const display = await generateCourseGuidedImageContent(
          input,
          (next) => {
            phase = next;
          },
        );
        await log?.finish({
          status: "success",
          durationMs: Date.now() - started,
          response: { phase: "complete", imageHash: display.image.sha256 },
        });
        return display;
      } catch (error) {
        const reason = sanitizeBackendErrorText(error, 2000);
        await log?.finish({
          status: "error",
          durationMs: Date.now() - started,
          error: `${phase}: ${reason}`,
          response: { phase, cancelled: input.signal?.aborted === true },
        });
        throw error;
      }
    },
  );
}

async function generateCourseGuidedImageContent(
  input: CourseGuidedImageInput,
  onPhase: (phase: string) => void,
) {
  const teacher = getBuiltinTeachingPersona(input.personaRef);
  if (!teacher)
    throw new Error("The selected image-first teacher is unavailable");
  const persona = {
    ref: teacher.ref,
    name: teacher.name,
    avatarCode: teacher.avatarCode,
  };
  const personaInstruction = ["base", "course"]
    .map((part) =>
      formatTeachingPersonaPromptPart(teacher, part as "base" | "course"),
    )
    .join("\n\n");
  const scopeId = createHash("sha256")
    .update(
      JSON.stringify({
        unitId: input.unitId,
        sectionId: input.sectionId,
        revisionId: input.revisionId,
        fingerprint: guidedImageFingerprint(input.intent, persona),
        personaInstruction,
      }),
    )
    .digest("hex");
  const repository = requireAgentConversationPersistence();
  const thread = await repository.findOrCreateScopedThread({
    userId: input.userId,
    scope: "guided_image_display",
    scopeId,
    stateJson: JSON.stringify({ goalId: input.goalId, unitId: input.unitId }),
  });
  const stored = JSON.parse(thread.stateJson || "{}") as {
    goalId: string;
    unitId: string;
    checkpoint?: GuidedImageCheckpoint;
  };
  if (stored.goalId !== input.goalId || stored.unitId !== input.unitId)
    throw new Error("Guided image child ownership mismatch");
  const signal = input.signal ?? new AbortController().signal;
  const imageData = async (image: GuidedImageAsset) => {
    // Resolve from the frozen hash and owning unit, never fetch arbitrary URLs.
    const found = await readUnitImage(
      input.unitId,
      `ill-guided-${image.sha256}`,
    );
    if (!found || imageSha256(found.data) !== image.sha256)
      throw new Error(
        "The saved image is missing or changed; regenerate this topic",
      );
    return found.data;
  };
  const dataUrl = async (image: GuidedImageAsset) =>
    `data:image/png;base64,${(await imageData(image)).toString("base64")}`;
  const display = await runGuidedImageDisplay({
    runId: thread.id,
    intent: input.intent,
    persona,
    signal,
    checkpoint: stored.checkpoint,
    save: async (checkpoint) => {
      onPhase(checkpoint.phase);
      await repository.updateThreadState(
        thread.id,
        JSON.stringify({
          goalId: input.goalId,
          unitId: input.unitId,
          checkpoint,
        }),
      );
      await input.onProgress?.(
        checkpoint.status === "waiting" ? "waiting" : checkpoint.phase,
      );
    },
    ports: {
      generateImage: async (intent, imageSignal, feedback) => {
        await ensureImageRuntimeConfig();
        assertImageGenerationConfigured();
        const provider = getImageProvider();
        if (!provider)
          throw new Error(
            "Configure an image provider before using this teacher's image-first lesson",
          );
        const generated = await provider.generateImage({
          prompt: guidedImagePrompt(intent, feedback?.issues),
          labelLanguage: resolveGoalContentLanguage(
            intent.language,
            intent.title,
          ),
          aspectRatio: "4:3",
          style: "concept",
          resolution: "2k",
          signal: imageSignal,
        });
        const normalized = await normalizeGuidedImage(generated.data);
        const saved = await saveGuidedUnitImage(input.unitId, normalized.data);
        return {
          src: saved.src,
          sha256: saved.sha256,
          width: normalized.width,
          height: normalized.height,
        };
      },
      verifyImage: async (image) => {
        await imageData(image);
      },
      segment: async (intent, image, stageSignal) =>
        segmentGuidedImage({
          intent,
          image,
          dataUrl: await dataUrl(image),
          signal: stageSignal,
        }),
      cut: async (image, segmentation, stageSignal) => {
        const data = await imageData(image);
        const cutouts = [];
        for (const region of segmentation.regions) {
          stageSignal.throwIfAborted();
          const saved = await saveGuidedUnitImage(
            input.unitId,
            await cutGuidedImageRegion(data, image, region),
          );
          cutouts.push({ regionId: region.id, src: saved.src });
        }
        return cutouts;
      },
      narrate: async (intent, image, segmentation, stageSignal) =>
        narrateGuidedImage({
          intent,
          image,
          segmentation,
          dataUrl: await dataUrl(image),
          personaInstruction,
          signal: stageSignal,
        }),
    },
  });
  onPhase("validation");
  return guidedImageDisplaySchema.parse(display);
}
