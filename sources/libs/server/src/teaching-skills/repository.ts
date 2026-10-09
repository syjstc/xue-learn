import { getEmbeddings } from "../llm/client.js";
import {
  ensureLlmRuntimeConfig,
  getLlmRuntimeConfig,
} from "../llm/runtime-config.js";
import { ensurePersonalSyncCapture } from "../personal-sync/index.js";
import { requireTeachingSkillRuntimePersistence } from "./persistence.js";
import type { TeachingSkillPackage } from "./types.js";
export { builtinRoot, readPackageDirectory } from "./builtin-files.js";

export const GENERAL_TEACHING_SKILL_SLUG = "general-teaching";
export const TEACHING_SKILL_INDEX_EVENT = "teaching_skill.index";
export function teachingSkillSearchText(
  pkg: Pick<TeachingSkillPackage, "name" | "description"> & {
    adapter: Pick<
      TeachingSkillPackage["adapter"],
      "topicCategory" | "domainPaths" | "tags" | "learningModes"
    >;
  },
): string {
  return [
    pkg.name,
    pkg.description,
    pkg.adapter.topicCategory,
    ...pkg.adapter.domainPaths,
    ...pkg.adapter.tags,
    ...pkg.adapter.learningModes,
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export async function processTeachingSkillIndexEvent(payload: string) {
  const parsed = JSON.parse(payload) as { versionId?: unknown };
  if (typeof parsed.versionId !== "string") {
    throw new Error("Teaching skill index event requires versionId");
  }
  await indexTeachingSkillVersion(parsed.versionId);
}

export async function indexTeachingSkillVersion(versionId: string) {
  const persistence = requireTeachingSkillRuntimePersistence();
  const version = await persistence.findIndexSource(versionId);
  if (!version) throw new Error("Teaching skill version not found");
  try {
    await ensureLlmRuntimeConfig();
    const runtime = getLlmRuntimeConfig();
    const embeddings = await getEmbeddings();
    const [vector] = await embeddings.embedDocuments([version.searchText]);
    if (!vector) throw new Error("Embedding runtime returned no vector");
    await ensurePersonalSyncCapture(() =>
      persistence.saveIndexResult({
        versionId,
        vector,
        provider: runtime.embeddingProvider,
        model: runtime.embeddingModel,
      }),
    );
    return true;
  } catch (error) {
    await ensurePersonalSyncCapture(() =>
      persistence.saveIndexResult({
        versionId,
        error: error instanceof Error ? error.message : "Indexing failed",
      }),
    );
    return false;
  }
}

export async function retryTeachingSkillIndexes(
  limit: number,
  target: Readonly<{ provider: string; model: string }>,
): Promise<{ attempted: number; indexed: number }> {
  const persistence = requireTeachingSkillRuntimePersistence();
  const rows = await persistence.listIndexSources({ ...target, limit });
  let indexed = 0;
  for (const row of rows) {
    if (await indexTeachingSkillVersion(row.id)) indexed += 1;
  }
  return { attempted: rows.length, indexed };
}
