export type ExistingUnitCurriculumIdentity = {
  id: string;
  parentUnitId: string | null;
  title: string;
  contentSummary: string;
  curriculumKey: string;
};

export type CandidateUnitCurriculumIdentity = {
  title: string;
  parentTitle?: string | null;
  contentSummary?: string | null;
};

export type ReconciledUnitCurriculumIdentity = {
  curriculumKey: string | null;
  sourceUnitId: string | null;
  reuseLearningTargets: boolean;
};

export function normalizeUnitIdentityText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase()
    .replace(/[\s\u3000]+/g, " ");
}

function uniqueByPath<T>(rows: Array<{ path: string; value: T }>) {
  const values = new Map<string, T>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    if (values.has(row.path)) {
      duplicates.add(row.path);
      continue;
    }
    values.set(row.path, row.value);
  }
  for (const path of duplicates) values.delete(path);
  return values;
}

/**
 * Reuse immutable curriculum keys only for unambiguous semantic positions.
 * A full map regeneration may recreate database ids, but an unchanged unique
 * ancestor/title path keeps its knowledge identity. Exact scope equality is
 * additionally required before durable point mappings are carried forward.
 */
export function reconcileUnitCurriculumKeys(
  existing: ExistingUnitCurriculumIdentity[],
  candidates: CandidateUnitCurriculumIdentity[],
): ReconciledUnitCurriculumIdentity[] {
  const existingById = new Map(existing.map((unit) => [unit.id, unit]));
  const pathMemo = new Map<string, string>();

  const pathForExisting = (unit: ExistingUnitCurriculumIdentity): string => {
    const memo = pathMemo.get(unit.id);
    if (memo) return memo;
    const seen = new Set<string>([unit.id]);
    const parts = [normalizeUnitIdentityText(unit.title)];
    let parentId = unit.parentUnitId;
    while (parentId) {
      if (seen.has(parentId)) break;
      seen.add(parentId);
      const parent = existingById.get(parentId);
      if (!parent) break;
      parts.unshift(normalizeUnitIdentityText(parent.title));
      parentId = parent.parentUnitId;
    }
    const path = parts.join("/");
    pathMemo.set(unit.id, path);
    return path;
  };

  const existingByPath = uniqueByPath(
    existing
      .filter((unit) => Boolean(unit.curriculumKey))
      .map((unit) => ({ path: pathForExisting(unit), value: unit })),
  );
  const candidateIndexesByTitle = new Map<string, number[]>();
  candidates.forEach((candidate, index) => {
    const title = normalizeUnitIdentityText(candidate.title);
    candidateIndexesByTitle.set(title, [
      ...(candidateIndexesByTitle.get(title) ?? []),
      index,
    ]);
  });
  const candidatePathMemo = new Map<number, string>();
  const pathForCandidate = (index: number, visiting = new Set<number>()): string => {
    const memo = candidatePathMemo.get(index);
    if (memo) return memo;
    const candidate = candidates[index]!;
    const title = normalizeUnitIdentityText(candidate.title);
    const parentTitle = normalizeUnitIdentityText(candidate.parentTitle);
    if (!parentTitle) {
      candidatePathMemo.set(index, title);
      return title;
    }
    const parentIndexes = (candidateIndexesByTitle.get(parentTitle) ?? []).filter(
      (candidateIndex) => candidateIndex !== index,
    );
    // A title-only parent reference cannot safely identify one of several
    // same-named ancestors. Give it a path that can never match persisted
    // curriculum state instead of guessing and stealing an immutable key.
    if (parentIndexes.length > 1 || visiting.has(index)) {
      return `__unresolved_parent__/${index}/${parentTitle}/${title}`;
    }
    if (parentIndexes.length === 0) {
      const path = `${parentTitle}/${title}`;
      candidatePathMemo.set(index, path);
      return path;
    }
    const nextVisiting = new Set(visiting);
    nextVisiting.add(index);
    const path = `${pathForCandidate(parentIndexes[0]!, nextVisiting)}/${title}`;
    candidatePathMemo.set(index, path);
    return path;
  };
  const candidatePaths = candidates.map((_, index) => pathForCandidate(index));
  const uniqueCandidatePaths = uniqueByPath(
    candidatePaths.map((path, index) => ({ path, value: index })),
  );
  const usedCurriculumKeys = new Set<string>();

  return candidates.map((candidate, index) => {
    const path = candidatePaths[index]!;
    if (uniqueCandidatePaths.get(path) !== index) {
      return {
        curriculumKey: null,
        sourceUnitId: null,
        reuseLearningTargets: false,
      };
    }
    const matched = existingByPath.get(path);
    if (!matched || usedCurriculumKeys.has(matched.curriculumKey)) {
      return {
        curriculumKey: null,
        sourceUnitId: null,
        reuseLearningTargets: false,
      };
    }
    usedCurriculumKeys.add(matched.curriculumKey);
    return {
      curriculumKey: matched.curriculumKey,
      sourceUnitId: matched.id,
      reuseLearningTargets:
        normalizeUnitIdentityText(candidate.contentSummary) ===
        normalizeUnitIdentityText(matched.contentSummary),
    };
  });
}
