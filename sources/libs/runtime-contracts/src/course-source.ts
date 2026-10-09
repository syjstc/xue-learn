import { z } from "zod";

const id = z.string().min(1);
const revision = z.number().int().nonnegative();
export const courseSourceAssetSchema = z.object({
  resourceId: id, sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  mediaType: z.string().nullable(), byteLength: z.number().int().nonnegative().nullable(),
  availability: z.enum(["available", "missing", "external"]),
  source: z.string(),
}).strict();
/** Original accepted JSON remains opaque here; its owning Core format validates it. */
export const courseSourceSectionSchema = z.object({
  id, orderIndex: z.number().int(), title: z.string(), scope: z.string(), contentKind: z.string(),
  assessmentAfter: z.boolean(), testGenerationStatus: z.string(),
  generationStatus: z.string(), publishedRevision: revision,
  availability: z.enum(["published", "missing"]), derivationFormat: z.string().nullable(),
  material: z.object({ introduction: z.string(), blocks: z.unknown(), keyTakeaways: z.unknown() }).strict().nullable(),
  derivationDocument: z.unknown().nullable(), teachingDerivationDocument: z.unknown().nullable(),
  teachingDerivationDerived: z.unknown().nullable(),
  presentationVersions: z.record(z.string(), z.string()),
}).strict();
export const courseSourceSnapshotSchema = z.object({
  contractVersion: z.literal("course-source.v1"), snapshotId: id,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/), capturedAt: z.string().datetime(),
  source: z.object({ workspaceId: id, ownerId: id, goalId: id, moduleId: id.nullable(), unitId: id,
    moduleOrderIndex: z.number().int().nullable(), unitOrderIndex: z.number().int() }).strict(),
  metadata: z.object({ goalTitle: z.string(), goalKind: z.string(), title: z.string(), unitKind: z.string(),
    contentLanguage: z.string(), scope: z.string(), publishedRevision: revision,
    learningTargets: z.array(z.unknown()) }).strict(),
  preview: z.object({ status: z.enum(["ready", "missing", "pending", "not-required"]), data: z.unknown().nullable() }).strict(),
  sections: z.array(courseSourceSectionSchema),
  legacyMaterial: z.object({ introduction: z.string(), sections: z.unknown(), keyTakeaways: z.unknown() }).strict().nullable(),
  assets: z.array(courseSourceAssetSchema),
}).strict();
export type CourseSourceSnapshotV1 = z.infer<typeof courseSourceSnapshotSchema>;
export type CourseSourceSectionV1 = z.infer<typeof courseSourceSectionSchema>;
export type CourseSourceAssetV1 = z.infer<typeof courseSourceAssetSchema>;
