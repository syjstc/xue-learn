import { z } from "zod";

export const memoryKindSchema = z.enum([
  "personal_fact",
  "preference",
  "constraint",
  "episode",
]);
export const memoryStatusSchema = z.enum(["active", "superseded", "archived"]);
export const memoryAuthoritySchema = z.enum([
  "learner_declared",
  "conversation_derived",
  "trusted_workflow",
]);
export const memoryScopeSchema = z.object({
  productId: z.string(),
  domain: z.string(),
  scopeType: z.enum(["user", "goal", "thread"]),
  scopeId: z.string().nullable(),
});
export const memoryEvidenceSchema = z.object({
  id: z.string(),
  sourceType: z.enum(["message", "workflow", "manual"]),
  excerpt: z.string(),
  occurredAt: z.string(),
});
export const memoryItemSchema = z.object({
  id: z.string(),
  kind: memoryKindSchema,
  summary: z.string(),
  stableKey: z.string(),
  authority: memoryAuthoritySchema,
  status: memoryStatusSchema,
  confidence: z.number(),
  importance: z.number(),
  scope: memoryScopeSchema,
  evidence: z.array(memoryEvidenceSchema),
  asOf: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const relevantMemoryResultSchema = z.object({
  query: z.string(),
  memories: z.array(memoryItemSchema),
});

export const createMemoryPayloadSchema = z
  .object({
    kind: memoryKindSchema.exclude(["episode"]),
    summary: z.string().trim().min(1).max(2_000),
    stableKey: z.string().trim().max(240).optional(),
    importance: z.number().min(0).max(1).default(0.5),
    scopeType: z.enum(["user", "goal", "thread"]).default("user"),
    scopeId: z.string().trim().min(1).nullable().optional(),
  })
  .strict();

export const correctMemoryPayloadSchema = z
  .object({
    memoryId: z.string().trim().min(1),
    summary: z.string().trim().min(1).max(2_000),
    importance: z.number().min(0).max(1).optional(),
  })
  .strict();

export const memoryIdPayloadSchema = z
  .object({ memoryId: z.string().trim().min(1) })
  .strict();

export const candidateExtractionSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            kind: memoryKindSchema.exclude(["episode"]),
            stableKey: z.string().trim().min(1).max(240),
            summary: z.string().trim().min(1).max(2_000),
            action: z.enum(["add", "reinforce", "correct", "noop"]),
            confidence: z.number().min(0).max(1),
            importance: z.number().min(0).max(1),
            explicit: z.boolean(),
            sourceMessageId: z.string().trim().min(1),
            existingRecordId: z.string().trim().min(1).nullable(),
          })
          .strict(),
      )
      .max(5),
  })
  .strict();

export type MemoryItemDto = z.infer<typeof memoryItemSchema>;
export type CandidateExtraction = z.infer<typeof candidateExtractionSchema>;
