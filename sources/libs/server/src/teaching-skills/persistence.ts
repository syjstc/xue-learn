export type TeachingSkillRuntimeSkill = Readonly<{
  id: string;
  slug: string;
}>;

export type TeachingSkillRuntimeCandidate = Readonly<{
  skillId: string;
  slug: string;
  name: string;
  description: string;
  topicCategory: string;
  domainPaths: unknown;
  tags: unknown;
  learningModes: unknown;
  score: number;
}>;

export type TeachingSkillRuntimeBinding = Readonly<{
  id: string;
  role: string;
  skill: TeachingSkillRuntimeSkill;
  currentPublishedVersion: null | Readonly<{
    version: number;
    name: string;
    contentHash: string;
    appliesTo: unknown;
    skillMd: string;
    files: readonly Readonly<{
      path: string;
      content: string;
      appliesTo: unknown;
      keywords: unknown;
    }>[];
  }>;
}>;

export interface TeachingSkillRuntimePersistence {
  ensureBuiltins(): Promise<void>;
  findPrimaryBinding(
    goalId: string,
  ): Promise<TeachingSkillRuntimeBinding | null>;
  findCandidates(
    query: string,
    embedding: readonly number[] | null,
    identity?: Readonly<{ provider: string; model: string }>,
  ): Promise<readonly TeachingSkillRuntimeCandidate[]>;
  findSkills(
    ids: readonly string[],
  ): Promise<readonly TeachingSkillRuntimeSkill[]>;
  findGeneralSkill(): Promise<TeachingSkillRuntimeSkill | null>;
  saveAutomaticBindings(
    input: Readonly<{
      goalId: string;
      inputHash: string;
      reason: string;
      primary: Readonly<{
        skillId: string;
        confidence: number;
        reason: string;
      }>;
      helpers: readonly Readonly<{
        skillId: string;
        confidence: number;
        reason: string;
      }>[];
    }>,
  ): Promise<TeachingSkillRuntimeBinding>;
  setPrimaryBinding(
    input: Readonly<{
      goalId: string;
      skillId: string;
      adminLocked: boolean;
    }>,
  ): Promise<TeachingSkillRuntimeBinding | null>;
  loadBindings(goalId: string): Promise<readonly TeachingSkillRuntimeBinding[]>;
  listAdmin(input: {
    query?: string;
    status?: string;
    category?: string;
    path?: string;
    tag?: string;
  }): Promise<readonly Readonly<Record<string, unknown>>[]>;
  findAdmin(id: string): Promise<Readonly<Record<string, unknown>> | null>;
  saveDraft(input: {
    files: Record<string, string>;
    adminUserId?: string;
    source?: "admin" | "builtin";
  }): Promise<{ skillId: string; versionId: string }>;
  publishDraft(skillId: string): Promise<string>;
  archive(skillId: string): Promise<boolean>;
  findPublishedVersionId(skillId: string): Promise<string | null>;
  exportFiles(versionId: string): Promise<Record<string, string>>;
  findGoal(
    goalId: string,
  ): Promise<Readonly<{
    id: string;
    title: string;
    level: string;
    generationOptions: unknown;
  }> | null>;
  findIndexSource(
    versionId: string,
  ): Promise<Readonly<{ id: string; searchText: string }> | null>;
  listIndexSources(input: {
    provider: string;
    model: string;
    limit: number;
  }): Promise<readonly Readonly<{ id: string; searchText: string }>[]>;
  saveIndexResult(input: {
    versionId: string;
    vector?: readonly number[];
    provider?: string;
    model?: string;
    error?: string;
  }): Promise<void>;
}

let configured: TeachingSkillRuntimePersistence | undefined;

export function configureTeachingSkillRuntimePersistence(
  persistence: TeachingSkillRuntimePersistence | undefined,
): void {
  configured = persistence;
}

export function requireTeachingSkillRuntimePersistence(): TeachingSkillRuntimePersistence {
  if (!configured)
    throw new Error("Teaching-skill runtime persistence is not configured");
  return configured;
}
