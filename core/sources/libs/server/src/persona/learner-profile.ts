import type {
  LearnerProfileRepository,
  LearnerStateMemoryReadRepository,
} from "../../../domain/src/index.js";
import { z } from "zod";
import { LEARNER_NAME_PLACEHOLDER } from "../learning-systems/learner-name-placeholder-policy.js";

export const learnerAgeRangeSchema = z.enum([
  "18_24",
  "25_34",
  "35_44",
  "45_plus",
  "prefer_not_to_say",
]);

export const learnerEducationLevelSchema = z.enum([
  "high_school",
  "vocational",
  "undergraduate",
  "graduate",
  "self_taught",
  "prefer_not_to_say",
]);

export const learnerKnowledgeLevelSchema = z.enum([
  "heard_of",
  "basic",
  "working",
  "strong",
]);

export const learnerKnowledgeItemSchema = z.object({
  topic: z.string().trim().min(1).max(120),
  domain: z.string().trim().max(80).optional(),
  level: learnerKnowledgeLevelSchema,
  confidence: z.literal("user_stated").default("user_stated"),
  source: z.enum(["onboarding", "manual"]).default("manual"),
  updatedAt: z.string().datetime(),
});

export const learnerProfileSchema = z.object({
  onboardingCompleted: z.boolean().default(false),
  nickname: z.string().trim().min(1).max(40).optional(),
  ageRange: learnerAgeRangeSchema.optional(),
  educationLevel: learnerEducationLevelSchema.optional(),
  majorOrField: z.string().trim().max(400).optional(),
  customInfo: z.string().trim().max(500).optional(),
  generalSkills: z.array(z.string().trim().min(1).max(80)).default([]),
  knowledgeItems: z.array(learnerKnowledgeItemSchema).default([]),
});

export const learnerProfilePatchSchema = learnerProfileSchema.partial().extend({
  generalSkills: z.array(z.string().trim().min(1).max(80)).optional(),
  knowledgeItems: z.array(learnerKnowledgeItemSchema).optional(),
});

export const learnerKnowledgeUpsertSchema = learnerKnowledgeItemSchema
  .omit({ updatedAt: true })
  .extend({
    updatedAt: z.string().datetime().optional(),
  });

export type LearnerProfile = z.infer<typeof learnerProfileSchema>;
export type LearnerProfilePatch = z.infer<typeof learnerProfilePatchSchema>;
export type LearnerKnowledgeUpsert = z.infer<
  typeof learnerKnowledgeUpsertSchema
>;

let configuredLearnerProfile: LearnerProfileRepository | undefined;

export function configureLearnerProfilePersistence(
  repository: LearnerProfileRepository | undefined,
): void {
  configuredLearnerProfile = repository;
}

function persistence(): LearnerProfileRepository {
  if (!configuredLearnerProfile)
    throw new Error("Learner-profile persistence is not configured");
  return configuredLearnerProfile;
}

const LEARNER_PROFILE_KEYS = new Set([
  "onboardingCompleted",
  "nickname",
  "ageRange",
  "educationLevel",
  "majorOrField",
  "customInfo",
  "generalSkills",
  "knowledgeItems",
]);
const LEGACY_DERIVED_MEMORY_KEYS = [
  "narrative",
  "activeTopics",
  "preferences",
  "recentPatterns",
  "weakTopics",
  "strongTopics",
  "completedGoals",
  "flashcardWeakTopics",
  "flashcardStrengths",
  "learningSpeed",
  "totalLearningSeconds",
  "memoryUpdatedAt",
] as const;

function parseJsonObject(
  raw: string | null | undefined,
): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function normalizeTextList(values: string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].slice(0, 40);
}

function normalizeKnowledgeTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function extractLearnerProfile(
  raw: Record<string, unknown>,
): LearnerProfile {
  const direct = learnerProfileSchema.safeParse(raw);
  if (direct.success) {
    return {
      ...direct.data,
      generalSkills: normalizeTextList(direct.data.generalSkills),
    };
  }

  return {
    onboardingCompleted: raw.onboardingCompleted === true,
    nickname:
      typeof raw.nickname === "string"
        ? raw.nickname.trim().slice(0, 40) || undefined
        : undefined,
    ageRange: learnerAgeRangeSchema.safeParse(raw.ageRange).success
      ? (raw.ageRange as LearnerProfile["ageRange"])
      : undefined,
    educationLevel: learnerEducationLevelSchema.safeParse(raw.educationLevel)
      .success
      ? (raw.educationLevel as LearnerProfile["educationLevel"])
      : undefined,
    majorOrField:
      typeof raw.majorOrField === "string"
        ? raw.majorOrField.trim()
        : undefined,
    customInfo:
      typeof raw.customInfo === "string"
        ? raw.customInfo.trim().slice(0, 500) || undefined
        : undefined,
    generalSkills: Array.isArray(raw.generalSkills)
      ? normalizeTextList(
          raw.generalSkills.filter(
            (item): item is string => typeof item === "string",
          ),
        )
      : [],
    knowledgeItems: Array.isArray(raw.knowledgeItems)
      ? raw.knowledgeItems
          .map((item) => learnerKnowledgeItemSchema.safeParse(item))
          .filter(
            (
              item,
            ): item is {
              success: true;
              data: LearnerProfile["knowledgeItems"][number];
            } => item.success,
          )
          .map((item) => item.data)
      : [],
  };
}

export function mergeLearnerProfileJson(
  existingRaw: Record<string, unknown>,
  patch: LearnerProfilePatch,
): Record<string, unknown> {
  const current = extractLearnerProfile(existingRaw);
  const next: LearnerProfile = {
    ...current,
    ...patch,
    generalSkills:
      patch.generalSkills !== undefined
        ? normalizeTextList(patch.generalSkills)
        : current.generalSkills,
    knowledgeItems: patch.knowledgeItems ?? current.knowledgeItems,
    nickname:
      patch.nickname !== undefined
        ? patch.nickname.trim().slice(0, 40) || undefined
        : current.nickname,
    majorOrField:
      patch.majorOrField !== undefined
        ? patch.majorOrField.trim() || undefined
        : current.majorOrField,
    customInfo:
      patch.customInfo !== undefined
        ? patch.customInfo.trim().slice(0, 500) || undefined
        : current.customInfo,
  };

  const merged = { ...existingRaw };
  for (const key of [...LEARNER_PROFILE_KEYS, ...LEGACY_DERIVED_MEMORY_KEYS]) {
    delete merged[key];
  }
  return { ...merged, ...next };
}

export function upsertLearnerKnowledgeItem(
  profile: LearnerProfile,
  item: LearnerKnowledgeUpsert,
): LearnerProfile {
  const now = new Date().toISOString();
  const nextItem = learnerKnowledgeItemSchema.parse({
    ...item,
    updatedAt: item.updatedAt ?? now,
  });
  const target = normalizeKnowledgeTopic(nextItem.topic);
  const filtered = profile.knowledgeItems.filter(
    (existing) => normalizeKnowledgeTopic(existing.topic) !== target,
  );
  return {
    ...profile,
    knowledgeItems: [...filtered, nextItem].slice(-80),
  };
}

export async function getLearnerProfile(
  userId: string,
  _compatibilityClient?: unknown,
): Promise<LearnerProfile> {
  const record = await persistence().findByUserId(userId);
  return extractLearnerProfile(parseJsonObject(record?.profileJson));
}

export async function getLearnerProfileSnapshot(userId: string): Promise<{
  profile: LearnerProfile;
  updatedAt: Date | null;
}> {
  const record = await persistence().findByUserId(userId);
  return {
    profile: extractLearnerProfile(parseJsonObject(record?.profileJson)),
    updatedAt: record?.updatedAt ?? null,
  };
}

export async function patchLearnerProfile(
  userId: string,
  patch: LearnerProfilePatch,
  _compatibilityClient?: unknown,
): Promise<LearnerProfile> {
  const repository = persistence();
  const existing = await repository.findByUserId(userId);
  const existingJson = parseJsonObject(existing?.profileJson);
  const merged = mergeLearnerProfileJson(existingJson, patch);

  const saved = await repository.upsert({
    userId,
    profileJson: JSON.stringify(merged),
  });

  return extractLearnerProfile(parseJsonObject(saved.profileJson));
}

export async function saveLearnerKnowledge(
  userId: string,
  item: LearnerKnowledgeUpsert,
  compatibilityClient?: unknown,
): Promise<LearnerProfile> {
  const current = await getLearnerProfile(userId, compatibilityClient);
  const next = upsertLearnerKnowledgeItem(current, item);
  return patchLearnerProfile(
    userId,
    { knowledgeItems: next.knowledgeItems },
    compatibilityClient,
  );
}

export function formatLearnerProfilePromptBlock(
  profile: LearnerProfile,
): string {
  const lines: string[] = [];
  if (profile.nickname) {
    lines.push(`Preferred nickname placeholder: ${LEARNER_NAME_PLACEHOLDER}`);
  }
  if (profile.ageRange) lines.push(`Age range: ${profile.ageRange}`);
  if (profile.educationLevel) {
    lines.push(`Education level: ${profile.educationLevel}`);
  }
  if (profile.majorOrField) lines.push(`Major/field: ${profile.majorOrField}`);
  if (profile.customInfo) lines.push(`About learner: ${profile.customInfo}`);
  if (profile.generalSkills.length > 0) {
    lines.push(
      `General skills: ${profile.generalSkills.slice(0, 12).join(", ")}`,
    );
  }
  if (profile.knowledgeItems.length > 0) {
    const backgroundKnowledge = profile.knowledgeItems.filter(
      (item) => item.source === "onboarding" || item.source === "manual",
    );
    if (backgroundKnowledge.length > 0) {
      const knowledge = backgroundKnowledge
        .slice(-12)
        .map((item) => `${item.topic} (${item.level}, ${item.confidence})`)
        .join("; ");
      lines.push(`Known topic profile: ${knowledge}`);
    }
  }
  if (lines.length === 0) return "";
  return `Learner profile (known context; do not re-ask):
${lines.join("\n")}
Use relevant background for brief bridges instead of reteaching it, but do not infer unstated mastery. Ask only about missing goal-specific prerequisites. Use the literal nickname placeholder naturally, not every turn; never replace it with a real name. Never address this individual as a group.`;
}

/** Extra teaching rules for main course material when a learner profile is present. */
export function learnerKnowledgeCourseTeachingBlock(
  profileBlock: string,
): string {
  if (!profileBlock.trim()) return "";
  return `Learner-knowledge teaching (course content):
- Use the learner profile above as global context — not material to repeat.
- When introducing new ideas, prefer short bridges from familiar profile knowledge (general skills, major/field, known topics).
- When useful, use ordinary stage subviews to contrast new material with what the learner already knows ("like X, but…", "unlike Y…", old mental model vs new).
- Skip reteaching profile foundations; help the learner map new ideas onto existing knowledge quickly.`;
}

export const LEARNER_PROFILE_CONTEXT_HEADER = "Learner profile (known context";
const PREVIOUS_LEARNER_PROFILE_CONTEXT_HEADER =
  "Learner profile (simple global context";
const LEGACY_LEARNER_PROFILE_CONTEXT_HEADER = "Learner profile context:";
const LEGACY_LEARNER_MEMORY_CONTEXT_HEADER =
  "Learner memory (behavioral traits";
const GLOBAL_LEARNER_STATE_MEMORY_CONTEXT_HEADER =
  "Global learner cognitive memory";

export function stripLearnerProfilePromptBlock(
  generationOptions: string | null | undefined,
): string {
  const text = generationOptions?.trim() ?? "";
  if (!text) return "";
  return text
    .split("\n\n")
    .filter(
      (section) =>
        !section.startsWith(LEARNER_PROFILE_CONTEXT_HEADER) &&
        !section.startsWith(PREVIOUS_LEARNER_PROFILE_CONTEXT_HEADER) &&
        !section.startsWith(LEGACY_LEARNER_PROFILE_CONTEXT_HEADER) &&
        !section.startsWith(LEGACY_LEARNER_MEMORY_CONTEXT_HEADER) &&
        !section.startsWith(GLOBAL_LEARNER_STATE_MEMORY_CONTEXT_HEADER),
    )
    .join("\n\n")
    .trim();
}

export async function appendLearnerProfileToPromptOptions(
  userId: string | null | undefined,
  generationOptions: string | null | undefined,
  memoryRead?: LearnerStateMemoryReadRepository,
): Promise<string> {
  const base = stripLearnerProfilePromptBlock(generationOptions);
  if (!userId) return base;
  const record = await persistence().findByUserId(userId);
  const raw = parseJsonObject(record?.profileJson);
  const profileBlock = formatLearnerProfilePromptBlock(
    extractLearnerProfile(raw),
  );
  const { formatGlobalLearnerStateMemoryPrompt } =
    await import("../learner-state-memory/index.js");
  const stateMemoryBlock = await formatGlobalLearnerStateMemoryPrompt(
    userId,
    undefined,
    memoryRead,
  );
  return [base, profileBlock, stateMemoryBlock].filter(Boolean).join("\n\n");
}
