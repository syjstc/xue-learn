import { apiGet } from "@/shared/api";
import { getAuthToken } from "@/shared/auth";
import { unitContentCache } from "@/shared/storage/unit-content-cache";
import type { ScenarioTheaterContent } from "@/shared/domain/scenario-theater";
import type { UnitLabContent } from "@xue-learn/core/source/src/shared/domain/unit-lab.ts";
import type { DerivationDocumentV1 } from "@xue-learn/core/source/libs/formal-derivation/src/index.ts";
import type {
  TeachingDerivationDerivedV1,
  TeachingDerivationDocumentV1,
} from "@xue-learn/core/source/libs/teaching-derivation/src/index.ts";
import { isDesktopLocalRuntime } from "@xue-learn/core/source/src/shared/runtime/client-runtime.ts";

export type UnitStableContent = {
  unitId: string;
  contentRevision: number;
  sq: unknown;
  material: unknown;
  materialSources: unknown[];
  scenarioTheaterContent?: ScenarioTheaterContent | null;
  unitLabContent?: UnitLabContent | null;
};

export type UnitSectionStableContent = {
  sectionId: string;
  contentRevision: number;
  blockOffset: number;
  material: unknown;
  contentKind?: "standard" | "formal_derivation";
  derivation?: DerivationDocumentV1 | null;
  derivationFormat?: "classic" | "teaching_v1" | null;
  teachingDerivation?: TeachingDerivationDocumentV1 | null;
  teachingDerivationDerived?: TeachingDerivationDerivedV1 | null;
};

function decodeUserIdFromToken(): string {
  const token = getAuthToken();
  if (!token) return "anonymous";
  try {
    const payload = JSON.parse(atob(token.split(".")[1] ?? "")) as {
      sub?: string;
    };
    return payload.sub?.trim() || "anonymous";
  } catch {
    return "anonymous";
  }
}

export async function loadUnitStableContent(
  unitId: string,
  revision: number,
): Promise<UnitStableContent> {
  if (isDesktopLocalRuntime()) {
    return apiGet<UnitStableContent>(
      `/api/units/${unitId}/content?revision=${encodeURIComponent(String(revision))}`,
    );
  }
  const userId = decodeUserIdFromToken();
  const cached = await unitContentCache.get<UnitStableContent>(
    userId,
    unitId,
    revision,
  );
  if (cached && cached.contentRevision === revision) {
    return cached;
  }

  const remote = await apiGet<UnitStableContent>(
    `/api/units/${unitId}/content?revision=${encodeURIComponent(String(revision))}`,
  );
  await unitContentCache.set(userId, unitId, remote.contentRevision, remote);
  return remote;
}

export async function loadUnitSectionStableContent(
  unitId: string,
  sectionId: string,
  revision: number,
): Promise<UnitSectionStableContent> {
  if (isDesktopLocalRuntime()) {
    return apiGet<UnitSectionStableContent>(
      `/api/units/${unitId}/sections/${encodeURIComponent(sectionId)}/content?revision=${encodeURIComponent(String(revision))}`,
    );
  }
  const userId = decodeUserIdFromToken();
  // Bump this namespace when the persisted material read contract changes.
  // v4 invalidates responses cached while the server normalizer dropped SVGs.
  const cacheUnitId = `${unitId}:${sectionId}:section-layout-v6`;
  const cached = await unitContentCache.get<UnitSectionStableContent>(
    userId,
    cacheUnitId,
    revision,
  );
  if (cached?.contentRevision === revision) return cached;
  const remote = await apiGet<UnitSectionStableContent>(
    `/api/units/${unitId}/sections/${encodeURIComponent(sectionId)}/content?revision=${encodeURIComponent(String(revision))}`,
  );
  await unitContentCache.set(userId, cacheUnitId, revision, remote);
  return remote;
}

export async function clearPrivateUnitContentCache(): Promise<void> {
  const userId = decodeUserIdFromToken();
  if (userId === "anonymous") {
    await unitContentCache.clearAll();
    return;
  }
  await unitContentCache.clearUser(userId);
}
