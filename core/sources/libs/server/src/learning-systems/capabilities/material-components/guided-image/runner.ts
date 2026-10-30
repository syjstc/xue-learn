import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type {
  GuidedImageAsset,
  GuidedImageBeat,
  GuidedImageDisplay,
  GuidedImageIntent,
  GuidedImageSegmentation,
} from "../../../../../../domain/src/guided-image.js";
import {
  guidedImageIntentSchema,
  narrationSchema,
  segmentationSchema,
} from "./schema.js";

export type GuidedImagePhase =
  | "image"
  | "segmentation"
  | "refinement"
  | "cutouts"
  | "narration"
  | "complete";
export type GuidedImageCheckpoint = {
  schemaVersion: 1;
  fingerprint: string;
  phase: GuidedImagePhase;
  status: "running" | "waiting" | "stopped" | "error" | "ready";
  retryAfter?: string;
  image?: GuidedImageAsset;
  segmentation?: GuidedImageSegmentation;
  observationVersion?: string;
  /** The accepted pixels were checked against earlier repair findings. */
  repairReviewVersion?: 1;
  coarseSegmentation?: GuidedImageSegmentation;
  refinementVersion?: string;
  cutouts?: GuidedImageDisplay["cutouts"];
  beats?: readonly GuidedImageBeat[];
  rejectedImages?: readonly {
    image: GuidedImageAsset;
    segmentation: GuidedImageSegmentation;
  }[];
  imageRepairRetry?: { key: string; rejectedImagesOffset: number; redrawFirst?: boolean };
  error?: string;
};
export type GuidedImagePorts = {
  generateImage: (
    intent: GuidedImageIntent,
    signal: AbortSignal,
    feedback?: { image: GuidedImageAsset; issues: readonly string[]; redraw?: true },
  ) => Promise<GuidedImageAsset>;
  verifyImage: (image: GuidedImageAsset) => Promise<void>;
  segment: (
    intent: GuidedImageIntent,
    image: GuidedImageAsset,
    signal: AbortSignal,
    previousImageIssues?: readonly string[],
  ) => Promise<GuidedImageSegmentation>;
  refine?: {
    version: string;
    run: (
      image: GuidedImageAsset,
      segmentation: GuidedImageSegmentation,
      signal: AbortSignal,
    ) => Promise<GuidedImageSegmentation>;
  };
  cut: (
    image: GuidedImageAsset,
    segmentation: GuidedImageSegmentation,
    signal: AbortSignal,
  ) => Promise<GuidedImageDisplay["cutouts"]>;
  narrate: (
    intent: GuidedImageIntent,
    image: GuidedImageAsset,
    segmentation: GuidedImageSegmentation,
    signal: AbortSignal,
  ) => Promise<readonly GuidedImageBeat[]>;
};

export function guidedImageFingerprint(
  intent: GuidedImageIntent,
  persona: GuidedImageDisplay["persona"],
) {
  return createHash("sha256")
    .update(JSON.stringify({ version: 1, intent, persona }))
    .digest("hex");
}

const activeRuns = new Map<
  string,
  { fingerprint: string; task: Promise<GuidedImageDisplay> }
>();

/** A bounded child workflow with injected storage/model ports. The caller owns
 * authorization, checkpoint storage, cancellation and the parent course commit. */
export function runGuidedImageDisplay(input: {
  runId: string;
  intent: GuidedImageIntent;
  persona: GuidedImageDisplay["persona"];
  checkpoint?: GuidedImageCheckpoint;
  ports: GuidedImagePorts;
  save: (checkpoint: GuidedImageCheckpoint) => Promise<void>;
  signal: AbortSignal;
  /** At most one automatic redraw by default. Originals remain in the checkpoint. */
  maxImageRepairs?: number;
  /** Stable across a parent request's automatic retries; new on explicit retry. */
  imageRepairRetryKey?: string;
  /** Re-observe rejected legacy checkpoints when the model's image input changes. */
  observationVersion?: string;
}): Promise<GuidedImageDisplay> {
  const intent = guidedImageIntentSchema.parse(input.intent);
  const fingerprint = guidedImageFingerprint(intent, input.persona);
  const existing = activeRuns.get(input.runId);
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      return Promise.reject(
        new Error("This run already belongs to another intent or persona"),
      );
    return existing.task;
  }
  if (
    input.checkpoint &&
    (input.checkpoint.schemaVersion !== 1 ||
      input.checkpoint.fingerprint !== fingerprint)
  ) {
    return Promise.reject(
      new Error("Intent or persona changed; start a new display run"),
    );
  }
  const task = execute();
  activeRuns.set(input.runId, { fingerprint, task });
  void task
    .finally(() => {
      if (activeRuns.get(input.runId)?.task === task)
        activeRuns.delete(input.runId);
    })
    .catch(() => {});
  return task;

  async function execute(): Promise<GuidedImageDisplay> {
    let state: GuidedImageCheckpoint = {
      ...input.checkpoint,
      schemaVersion: 1,
      fingerprint,
      phase: input.checkpoint?.phase ?? "image",
      status: "running",
    };
    const save = async (patch: Partial<GuidedImageCheckpoint>) => {
      state = { ...state, error: undefined, ...patch };
      await input.save(structuredClone(state));
    };
    const phase = async (next: GuidedImagePhase) => {
      input.signal.throwIfAborted();
      await save({ phase: next, status: "running", retryAfter: undefined });
    };
    const call = async <T>(work: () => Promise<T>): Promise<T> => {
      for (;;) {
        input.signal.throwIfAborted();
        try {
          return await work();
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (
            input.signal.aborted ||
            !/\b429\b|Throttling[.:]|rate_limit_exceeded|rate.?limit/i.test(
              message,
            )
          )
            throw error;
          await save({
            status: "waiting",
            retryAfter: new Date(Date.now() + 5000).toISOString(),
          });
          await delay(5000, undefined, { signal: input.signal });
          await save({ status: "running", retryAfter: undefined });
        }
      }
    };
    try {
      if (
        input.imageRepairRetryKey &&
        state.imageRepairRetry?.key !== input.imageRepairRetryKey
      ) {
        // Persist the new budget before any model call. Automatic parent retries
        // and a stop/resume in this request must not replenish it again.
        const previous = state.imageRepairRetry;
        const budget = input.maxImageRepairs ?? 1;
        const redrawFirst = Boolean(
          budget >= 2 && previous && input.checkpoint?.status === "error" &&
          input.checkpoint.error?.startsWith("Image needs review before narration") &&
          (state.rejectedImages?.length ?? 0) - previous.rejectedImagesOffset >= budget,
        );
        await save({
          imageRepairRetry: {
            key: input.imageRepairRetryKey,
            rejectedImagesOffset: state.rejectedImages?.length ?? 0,
            ...(redrawFirst ? { redrawFirst: true } : {}),
          },
        });
      }
      for (;;) {
        if (!state.image) {
          await phase("image");
          const rejected = state.rejectedImages?.at(-1);
          const budget = input.maxImageRepairs ?? 1;
          const attempt = (state.rejectedImages?.length ?? 0) -
            (state.imageRepairRetry?.rejectedImagesOffset ?? 0);
          // Avoid anchoring every correction to the same faulty geometry. A
          // completed failed grant starts with one fresh composition; otherwise
          // reserve the third bounded correction for a redraw after two edits.
          const redraw = Boolean(rejected && budget >= 3 && (
            state.imageRepairRetry?.redrawFirst ? attempt === 1 : attempt === 3
          ));
          const feedback = rejected
            ? {
                image: rejected.image,
                issues: [
                  ...rejected.segmentation.imageIssues,
                  ...rejected.segmentation.missingPartIds.map(
                    (id) => `Missing required part: ${id}`,
                  ),
                ],
                ...(redraw ? { redraw: true as const } : {}),
              }
            : undefined;
          const image = await call(() =>
            input.ports.generateImage(intent, input.signal, feedback),
          );
          // Save successful expensive work even if a stop arrived just after it.
          await save({ image });
        }
        input.signal.throwIfAborted();
        await input.ports.verifyImage(state.image!);
        const previousImageIssues = [...new Set(
          (state.rejectedImages ?? []).flatMap(({ segmentation }) => [
            ...segmentation.imageIssues,
            ...segmentation.missingPartIds.map((id) => `Missing required part: ${id}`),
          ]),
        )];
        const staleRejectedObservation = Boolean(
          input.observationVersion &&
          state.observationVersion !== input.observationVersion &&
          state.segmentation &&
          (state.segmentation.imageIssues.length ||
            intent.parts.some(
              (part) => part.required && state.segmentation!.missingPartIds.includes(part.id),
            )),
        );
        if (staleRejectedObservation) {
          // A transparent PNG previously observed against black can be rejected
          // even though the classroom's light matte makes its ink readable.
          // Recheck those exact pixels before spending on a replacement image.
          await save({
            segmentation: undefined,
            coarseSegmentation: undefined,
            refinementVersion: undefined,
            cutouts: undefined,
            beats: undefined,
          });
        }
        if (
          previousImageIssues.length &&
          state.repairReviewVersion !== 1 &&
          state.segmentation &&
          !state.segmentation.imageIssues.length &&
          !intent.parts.some((part) => part.required && state.segmentation!.missingPartIds.includes(part.id))
        ) {
          // Older accepted checkpoints did not carry prior findings into the
          // next review. Audit the SAME pixels once, without discarding valid
          // regions/narration or granting a new redraw budget.
          await phase("segmentation");
          const review = segmentationSchema(intent).parse(await call(() =>
            input.ports.segment(intent, state.image!, input.signal, previousImageIssues),
          ));
          const rejected = review.imageIssues.length || intent.parts.some(
            (part) => part.required && review.missingPartIds.includes(part.id),
          );
          await save({
            segmentation: rejected ? review : state.segmentation,
            observationVersion: input.observationVersion,
            repairReviewVersion: 1,
          });
        }
        if (!state.segmentation) {
          await phase("segmentation");
          const result = await call(() =>
            input.ports.segment(intent, state.image!, input.signal,
              previousImageIssues.length ? previousImageIssues : undefined),
          );
          await save({
            segmentation: segmentationSchema(intent).parse(result),
            observationVersion: input.observationVersion,
            repairReviewVersion: 1,
          });
        }
        const observed = segmentationSchema(intent).parse(state.segmentation);
        const missing = intent.parts.filter(
          (p) => p.required && observed.missingPartIds.includes(p.id),
        );
        if (!missing.length && !observed.imageIssues.length) break;
        if (
          (state.rejectedImages?.length ?? 0) -
            (state.imageRepairRetry?.rejectedImagesOffset ?? 0) >=
          (input.maxImageRepairs ?? 1)
        ) {
          throw new Error(
            `Image needs review before narration: ${[...missing.map((p) => `missing ${p.label}`), ...observed.imageIssues].join("; ")}`,
          );
        }
        await save({
          rejectedImages: [
            ...(state.rejectedImages ?? []),
            { image: state.image!, segmentation: observed },
          ],
          image: undefined,
          segmentation: undefined,
          coarseSegmentation: undefined,
          refinementVersion: undefined,
          cutouts: undefined,
          beats: undefined,
        });
      }
      const refiner = input.ports.refine;
      if (refiner && state.refinementVersion !== refiner.version) {
        await phase("refinement");
        const coarse = state.coarseSegmentation ?? state.segmentation!;
        const refined = segmentationSchema(intent).parse(
          await refiner.run(state.image!, coarse, input.signal),
        );
        if (
          JSON.stringify(refined.regions.map((r) => [r.id, r.partId])) !==
            JSON.stringify(coarse.regions.map((r) => [r.id, r.partId])) ||
          refined.imageIssues.length ||
          refined.missingPartIds.length
        ) {
          throw new Error(
            "Refinement must preserve observed region identities and coverage",
          );
        }
        await save({
          segmentation: refined,
          coarseSegmentation: coarse,
          refinementVersion: refiner.version,
          cutouts: undefined,
          beats: undefined,
        });
      }
      const segmentation = segmentationSchema(intent).parse(state.segmentation);
      // The durable original+polygons are authoritative. Re-derive cheap cutouts
      // on resume, so deleted or partially written PNGs cannot look complete.
      await phase("cutouts");
      const cutouts = await input.ports.cut(
        state.image!,
        segmentation,
        input.signal,
      );
      if (
        cutouts.length !== segmentation.regions.length ||
        segmentation.regions.some(
          (r) => cutouts.filter((c) => c.regionId === r.id).length !== 1,
        )
      ) {
        throw new Error("Every region must have exactly one registered cutout");
      }
      await save({ cutouts });
      const spokenSchema = narrationSchema(intent, segmentation);
      // Older checkpoints can contain beats accepted before narration validation
      // tightened. Revalidate before deciding to reuse them; otherwise every
      // retry skips the provider and fails again at the final parse below.
      // Retain the old beats until their replacement succeeds, including on stop.
      if (!spokenSchema.safeParse({ beats: state.beats }).success) {
        await phase("narration");
        const result = await call(() =>
          input.ports.narrate(intent, state.image!, segmentation, input.signal),
        );
        const { beats } = spokenSchema.parse({
          beats: result,
        });
        await save({ beats });
      }
      const { beats } = spokenSchema.parse({
        beats: state.beats,
      });
      input.signal.throwIfAborted();
      await save({ phase: "complete", status: "ready" });
      return {
        type: "guided_image",
        schemaVersion: 1,
        id: intent.id,
        intent,
        image: state.image!,
        segmentation,
        cutouts,
        beats,
        persona: input.persona,
        sourceFingerprint: fingerprint,
      };
    } catch (error) {
      await save({
        status: input.signal.aborted ? "stopped" : "error",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
