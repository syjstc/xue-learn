import { z } from "zod";

const idSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const genderSchema = z.enum(["male", "female"]);
const ageGroupSchema = z.enum(["young_adult", "middle_aged", "older_adult"]);

const characterSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(40),
  role: z.string().min(1).max(80),
  avatar: z.enum(["mentor", "peer", "client", "expert", "system"]),
  appearance: z
    .object({
      assetCode: idSchema,
      gender: genderSchema,
      ageGroup: ageGroupSchema,
    })
    .optional(),
});

const meterSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(20),
    initial: z.number().int(),
    min: z.number().int(),
    max: z.number().int(),
    tone: z.enum(["positive", "risk", "neutral"]),
  })
  .refine(
    (meter) =>
      meter.min < meter.max &&
      meter.initial >= meter.min &&
      meter.initial <= meter.max,
    { message: "meter initial must be within a non-empty range" },
  );

const effectSchema = z.object({
  meterId: idSchema,
  delta: z.number().int().min(-30).max(30),
});

const choiceSchema = z
  .object({
    id: idSchema,
    label: z.string().min(1).max(180),
    consequence: z.string().min(1).max(500),
    reflection: z.string().min(1).max(500),
    nextSceneId: idSchema.optional(),
    endingId: idSchema.optional(),
    effects: z.array(effectSchema).max(3),
  })
  .refine(
    (choice) => Boolean(choice.nextSceneId) !== Boolean(choice.endingId),
    { message: "choice must reference exactly one next scene or ending" },
  );

const backgroundSchema = z.enum([
  "briefing",
  "workspace",
  "conversation",
  "incident",
  "outcome",
  "technical_lab",
  "workshop",
  "meeting_room",
  "field_site",
  "customer_lounge",
]);
const sceneEffectSchema = z.enum(["none", "fade", "pulse", "shake", "success"]);

const legacySceneSchema = z.object({
  id: idSchema,
  act: z.number().int().min(1).max(3),
  title: z.string().min(1).max(80),
  speakerId: idSchema.optional(),
  body: z.string().min(1).max(1200),
  background: backgroundSchema,
  effect: sceneEffectSchema,
  choices: z.array(choiceSchema).min(2).max(3),
});

const storyBeatSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("dialogue"),
    speakerId: idSchema,
    text: z.string().min(1).max(240),
    addressee: z.literal("learner").optional(),
  }),
  z.object({
    kind: z.literal("narration"),
    tone: z.enum(["setup", "observation", "transition"]),
    text: z.string().min(1).max(240),
  }),
]);

const visualNovelSceneSchema = z
  .object({
    id: idSchema,
    act: z.number().int().min(1).max(3),
    title: z.string().min(1).max(80),
    beats: z.array(storyBeatSchema).min(6).max(10),
    background: backgroundSchema,
    effect: sceneEffectSchema,
    choices: z.array(choiceSchema).min(2).max(3),
  })
  .superRefine((scene, ctx) => {
    if (!scene.beats.some((beat) => beat.kind === "narration")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "visual-novel scene must contain coach narration",
        path: ["beats"],
      });
    }
    if (scene.beats.filter((beat) => beat.kind === "dialogue").length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "visual-novel scene must contain multiple dialogue beats",
        path: ["beats"],
      });
    }
  });

const endingSchema = z.object({
  id: idSchema,
  kind: z.enum(["strong", "mixed", "setback"]),
  title: z.string().min(1).max(80),
  summary: z.string().min(1).max(700),
  coachDebrief: z.string().min(1).max(1000),
});

const definitionBaseShape = {
  type: z.literal("scenario_theater"),
  title: z.string().min(1).max(80),
  premise: z.string().min(1).max(500),
  learnerRole: z.string().min(1).max(120),
  objective: z.string().min(1).max(300),
  theme: z.enum(["office", "technical", "conversation", "field", "generic"]),
  // New theater definitions use one setting for the whole unit. Optional keeps
  // already-published V1/V2 definitions, which stored settings per scene, readable.
  background: backgroundSchema.optional(),
  coach: z
    .object({
      name: z.string().min(1).max(40),
      avatarCode: idSchema,
    })
    .optional(),
  characters: z.array(characterSchema).max(4),
  meters: z.array(meterSchema).min(1).max(3),
  initialSceneId: idSchema,
  endings: z.array(endingSchema).min(2).max(4),
};

type RefinableDefinition = {
  version: 1 | 2;
  initialSceneId: string;
  characters: Array<{ id: string }>;
  meters: Array<{ id: string }>;
  endings: Array<{ id: string }>;
  scenes: Array<{
    id: string;
    speakerId?: string;
    beats?: Array<
      | {
          kind: "dialogue";
          speakerId: string;
          text: string;
          addressee?: "learner";
        }
      | {
          kind: "narration";
          tone: "setup" | "observation" | "transition";
          text: string;
        }
    >;
    choices: Array<{
      id: string;
      nextSceneId?: string;
      endingId?: string;
      effects: Array<{ meterId: string; delta: number }>;
    }>;
  }>;
};

function refineDefinition(
  definition: RefinableDefinition,
  ctx: z.RefinementCtx,
  bounds: { minDepth: number; maxDepth: number; requireVariable: boolean },
) {
  const duplicate = (values: string[]) =>
    values.find((value, index) => values.indexOf(value) !== index);
  const sceneIds = definition.scenes.map((scene) => scene.id);
  const endingIds = definition.endings.map((ending) => ending.id);
  const characterIds = definition.characters.map((character) => character.id);
  const meterIds = definition.meters.map((meter) => meter.id);

  for (const [label, values] of [
    ["scene", sceneIds],
    ["ending", endingIds],
    ["character", characterIds],
    ["meter", meterIds],
  ] as const) {
    const id = duplicate(values);
    if (id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate ${label} id: ${id}`,
      });
    }
  }

  const sceneById = new Map(
    definition.scenes.map((scene) => [scene.id, scene]),
  );
  const endingSet = new Set(endingIds);
  const characterSet = new Set(characterIds);
  const meterSet = new Set(meterIds);
  if (!sceneById.has(definition.initialSceneId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "initialSceneId must reference a scene",
    });
    return;
  }

  for (const scene of definition.scenes) {
    const speakerIds = [
      ...(scene.speakerId ? [scene.speakerId] : []),
      ...(scene.beats ?? []).flatMap((beat) =>
        beat.kind === "dialogue" ? [beat.speakerId] : [],
      ),
    ];
    for (const speakerId of speakerIds) {
      if (!characterSet.has(speakerId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown speakerId: ${speakerId}`,
        });
      }
    }
    const duplicateChoice = duplicate(scene.choices.map((choice) => choice.id));
    if (duplicateChoice) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate choice id in ${scene.id}: ${duplicateChoice}`,
      });
    }
    for (const choice of scene.choices) {
      if (choice.nextSceneId && !sceneById.has(choice.nextSceneId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown nextSceneId: ${choice.nextSceneId}`,
        });
      }
      if (choice.endingId && !endingSet.has(choice.endingId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `unknown endingId: ${choice.endingId}`,
        });
      }
      for (const effect of choice.effects) {
        if (!meterSet.has(effect.meterId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unknown meterId: ${effect.meterId}`,
          });
        }
      }
    }
  }

  const reachableScenes = new Set<string>();
  const reachableEndings = new Set<string>();
  const visiting = new Set<string>();
  let minDepth = Number.POSITIVE_INFINITY;
  let maxDepth = 0;
  let hasRecovery = false;
  const visit = (sceneId: string, depth: number, sawNegative: boolean) => {
    if (visiting.has(sceneId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `scene graph must be acyclic: ${sceneId}`,
      });
      return;
    }
    const scene = sceneById.get(sceneId);
    if (!scene) return;
    reachableScenes.add(sceneId);
    visiting.add(sceneId);
    for (const choice of scene.choices) {
      const negative =
        choice.effects.reduce((sum, effect) => sum + effect.delta, 0) < 0;
      if (sawNegative && !negative) hasRecovery = true;
      if (choice.endingId) {
        reachableEndings.add(choice.endingId);
        minDepth = Math.min(minDepth, depth);
        maxDepth = Math.max(maxDepth, depth);
      } else if (choice.nextSceneId) {
        visit(choice.nextSceneId, depth + 1, sawNegative || negative);
      }
    }
    visiting.delete(sceneId);
  };
  visit(definition.initialSceneId, 1, false);

  if (reachableScenes.size !== definition.scenes.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "all scenes must be reachable from initialSceneId",
    });
  }
  if (reachableEndings.size !== definition.endings.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "all endings must be reachable",
    });
  }
  if (minDepth < bounds.minDepth || maxDepth > bounds.maxDepth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `every play path must contain ${bounds.minDepth}-${bounds.maxDepth} decisions`,
    });
  }
  if (bounds.requireVariable && minDepth === maxDepth) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "visual-novel routes must have variable decision depths",
    });
  }
  if (!hasRecovery) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "at least one negative choice must have a later recovery",
    });
  }
}

export const scenarioTheaterDefinitionV1Schema = z
  .object({
    ...definitionBaseShape,
    version: z.literal(1),
    scenes: z.array(legacySceneSchema).min(3).max(14),
  })
  .superRefine((definition, ctx) =>
    refineDefinition(definition, ctx, {
      minDepth: 3,
      maxDepth: 5,
      requireVariable: false,
    }),
  );

export const scenarioTheaterDefinitionV2Schema = z
  .object({
    ...definitionBaseShape,
    version: z.literal(2),
    characters: z.array(characterSchema).min(2).max(4),
    scenes: z.array(visualNovelSceneSchema).min(8).max(20),
  })
  .superRefine((definition, ctx) =>
    refineDefinition(definition, ctx, {
      minDepth: 5,
      maxDepth: 8,
      requireVariable: true,
    }),
  );

export const scenarioTheaterDefinitionSchema = z.union([
  scenarioTheaterDefinitionV2Schema,
  scenarioTheaterDefinitionV1Schema,
]);

export type ScenarioTheaterDefinitionV1 = z.infer<
  typeof scenarioTheaterDefinitionV1Schema
>;
export type ScenarioTheaterDefinitionV2 = z.infer<
  typeof scenarioTheaterDefinitionV2Schema
>;
export type ScenarioTheaterDefinition = z.infer<
  typeof scenarioTheaterDefinitionSchema
>;
export type ScenarioTheaterStoryBeat = z.infer<typeof storyBeatSchema>;

export type ScenarioTheaterPathEntry = {
  sceneId: string;
  choiceId: string;
  consequence: string;
  reflection: string;
  effects: Array<{ meterId: string; delta: number }>;
  chosenAt: string;
};

export function parseScenarioTheaterDefinition(
  value: unknown,
): ScenarioTheaterDefinition {
  return scenarioTheaterDefinitionSchema.parse(value);
}
