import { z } from "zod";
import { TEACHING_RELATIONS } from "./types.js";
import { teachingVisualSchema, teachingVisualAssetSchema, teachingVisualDisplaySchema } from "./visual.js";

const keySchema = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/);

export const stepReferenceSchema = z.object({
  stepIndex: z.number().int().min(1).max(80),
  formulaKey: keySchema,
});

export const boardFormulaSchema = z.object({
  key: keySchema,
  title: z.string().min(1).max(80),
  latex: z.string().min(1).max(4000),
  role: z.enum(["primary", "reference"]),
  change: z
    .enum(["introduce", "transform", "hold"])
    .optional()
    .describe(
      "Per-formula action: introduce a new independent block, transform its source, or hold the exact existing formula. Lets a step retain its working formula while adding a supporting block.",
    ),
  source: stepReferenceSchema
    .optional()
    .describe(
      "Earlier formula this primary transforms or this reference quotes. Keep the same key for an ongoing working formula.",
    ),
});

const targetSchema = z.object({
  id: keySchema,
  formulaKey: keySchema,
  state: z.enum(["before", "after"]),
  latex: z.string().min(1).max(4000),
  path: z.array(z.object({
    role: z.enum(["operand", "left", "right", "numerator", "denominator", "radicand", "index", "base", "exponent", "subscript", "argument", "function", "lower", "upper", "integrand", "summand", "variable", "body", "row", "cell", "condition", "approach"]),
    index: z.number().int().min(0).optional(),
  })).max(24).optional(),
});
const MAX_CUE_TEXT_LENGTH = 240;
const MAX_STEP_CUES = 32;
const authoredNarrationSchema = z.string().min(1).max(800);
const cueSchema = z.object({
  id: keySchema,
  text: z.string().min(1).max(MAX_CUE_TEXT_LENGTH),
  targetIds: z.array(keySchema).max(8),
  startTransform: z.boolean().optional(),
  onScreenText: z.string().trim().min(1).max(160).optional()
    .describe("Brief visible explanation for this cue; retain the complete spoken explanation in text."),
  givenIndexes: z.array(z.number().int().min(0).max(11)).max(4).optional(),
  visualTargetIds: z.array(z.string().min(1).max(512)).max(8).optional(),
});
const intentSchema = z.object({
  kind: z.enum(["move", "swap", "replace", "cancel", "expand", "merge"]),
  before: z.array(keySchema).min(1).max(8),
  after: z.array(keySchema).min(1).max(8),
});

export const teachingDerivationStepSchema = z.object({
  index: z.number().int().min(1).max(80).optional(),
  board: z.array(boardFormulaSchema).min(1).max(8),
  relation: z.enum(TEACHING_RELATIONS),
  references: z.array(stepReferenceSchema).max(12).optional(),
  conditions: z.string().max(400).optional(),
  justification: z.string().min(1).max(800),
  narration: authoredNarrationSchema,
  presentationFallback: z.string().max(2000).optional(),
  focusFormulaKey: keySchema,
  givenIndexes: z.array(z.number().int().min(0).max(11)).max(4).optional(),
  visual: teachingVisualSchema.optional(),
  targets: z.array(targetSchema).max(32).optional(),
  cues: z.array(cueSchema).min(1).max(MAX_STEP_CUES).optional(),
  intents: z.array(intentSchema).max(8).optional(),
});

// Stored narration is the host's exact concatenation of all accepted cues.
// Keep authoring limits unchanged while accepting every valid committed cue.
export const committedTeachingDerivationStepSchema = teachingDerivationStepSchema.extend({
  narration: z.string().min(1).max(MAX_CUE_TEXT_LENGTH * MAX_STEP_CUES),
});

export const symbolDeclarationSchema = z.object({
  name: z.string().min(1).max(32),
  kind: z.enum(["variable", "function"]),
});

export const teachingDerivationDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().min(1).max(200),
  locale: z.string().min(2).max(16),
  lineageBackup: z.array(committedTeachingDerivationStepSchema).max(80).optional(),
  presentationBackup: z.array(teachingDerivationStepSchema.pick({ index: true, targets: true, cues: true, intents: true }).extend({ index: z.number().int().min(1).max(80) })).max(80).optional(),
  teachingGoal: z.string().min(1).max(800),
  givens: z.array(z.string().min(1).max(400)).max(12),
  symbols: z.array(symbolDeclarationSchema).max(32).optional(),
  visualAssets: z.array(teachingVisualAssetSchema).optional(),
  visualDisplays: z.array(teachingVisualDisplaySchema).optional(),
  steps: z.array(committedTeachingDerivationStepSchema).max(80),
  summary: z.string().max(800).optional(),
  status: z.enum(["draft", "complete"]),
  revision: z.number().int().min(0),
});

export const commitTeachingStepArgsSchema = teachingDerivationStepSchema.omit({ presentationFallback: true }).extend(
  {
    teachingGoal: z.string().min(1).max(800).optional(),
    givens: z.array(z.string().min(1).max(400)).max(12).optional(),
    symbols: z.array(symbolDeclarationSchema).max(32).optional(),
  },
);

export const inspectTeachingDerivationArgsSchema = z.object({}).strict();

export const finishTeachingDerivationArgsSchema = z.object({
  summary: z.string().max(800).optional(),
});
