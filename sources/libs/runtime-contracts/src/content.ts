import { z } from "zod";
import {
  localAudioProviderIds,
  localImageProviderIds,
  localSearchProviderIds,
} from "./providers.js";

export const localPlanningModeSchema = z.enum(["fast", "deep", "docs_first"]);
export const localResearchScopeSchema = z.enum(["goal", "module"]);

export const localContentContextSchema = z.object({
  planningMode: localPlanningModeSchema,
  researchScope: localResearchScopeSchema.default("goal"),
  documentsAvailable: z.boolean().default(false),
});
export type LocalContentContext = z.infer<typeof localContentContextSchema>;

export const localContentCapabilityRequestSchema = localContentContextSchema;

const localCapabilityStateSchema = z.object({
  status: z.enum(["available", "degraded", "blocked"]),
  providerId: z.string().nullable(),
  reason: z.string().min(1).nullable(),
});

export const localContentCapabilityResultSchema = z.object({
  planningMode: localPlanningModeSchema,
  researchScope: localResearchScopeSchema,
  primaryResearchSource: z.enum(["none", "web", "documents"]),
  webSearch: localCapabilityStateSchema.extend({
    providerId: z.enum(localSearchProviderIds).nullable(),
  }),
  image: localCapabilityStateSchema.extend({
    providerId: z.enum(localImageProviderIds).nullable(),
  }),
  audio: localCapabilityStateSchema.extend({
    providerId: z.enum(localAudioProviderIds).nullable(),
  }),
  svg: localCapabilityStateSchema,
});
export type LocalContentCapabilityResult = z.infer<
  typeof localContentCapabilityResultSchema
>;

export const localContentSearchRequestSchema = localContentContextSchema.extend(
  {
    query: z.string().trim().min(1).max(2_000),
    maxResults: z.number().int().min(1).max(10).default(5),
  },
);
export type LocalContentSearchRequest = z.infer<
  typeof localContentSearchRequestSchema
>;

export const localContentSearchResultSchema = z.object({
  status: z.enum(["ready", "fallback", "skipped"]),
  providerId: z.enum(localSearchProviderIds).nullable(),
  reason: z.string().min(1).nullable(),
  results: z.array(
    z.object({
      title: z.string(),
      url: z.string().url(),
      snippet: z.string(),
    }),
  ),
});
export type LocalContentSearchResult = z.infer<
  typeof localContentSearchResultSchema
>;

export const localImageGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  aspectRatio: z.enum(["1:1", "16:9", "9:16", "4:3", "3:4"]).default("16:9"),
  altText: z.string().trim().min(1).max(500),
});
export type LocalImageGenerationRequest = z.infer<
  typeof localImageGenerationRequestSchema
>;

export const localAudioGenerationRequestSchema = z.object({
  text: z.string().trim().min(1).max(12_000),
  language: z.string().trim().min(1).max(40).optional(),
});
export type LocalAudioGenerationRequest = z.infer<
  typeof localAudioGenerationRequestSchema
>;

export const localSvgGenerationRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(8_000),
  title: z.string().trim().min(1).max(300),
});
export type LocalSvgGenerationRequest = z.infer<
  typeof localSvgGenerationRequestSchema
>;

export const localBinaryContentResultSchema = z.object({
  status: z.enum(["ready", "fallback"]),
  providerId: z.string().nullable(),
  reason: z.string().min(1).nullable(),
  mimeType: z.string().min(1).nullable(),
  dataBase64: z.string().min(1).nullable(),
  fallback: z
    .object({ kind: z.enum(["image_callout", "text"]), content: z.string() })
    .nullable(),
});
export type LocalBinaryContentResult = z.infer<
  typeof localBinaryContentResultSchema
>;

export const localSvgGenerationResultSchema = z.object({
  status: z.enum(["ready", "fallback"]),
  providerId: z.string().nullable(),
  reason: z.string().min(1).nullable(),
  svg: z.string().min(1),
});
export type LocalSvgGenerationResult = z.infer<
  typeof localSvgGenerationResultSchema
>;
