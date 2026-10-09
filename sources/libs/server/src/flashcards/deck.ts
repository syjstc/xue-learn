import type { FlashcardExperienceRepository } from "../../../domain/src/index.js";
import {
  anchorContextSnippet,
  computeBlockKey,
  resolveBlockIndex,
  type MaterialAnchor,
} from "../domain/material-anchor.js";
import { createInitialFsrsState } from "../domain/fsrs.js";
import {
  parseLearningMaterial,
  serializeLearningMaterialForQuiz,
} from "../graph/unit-session.js";
import { streamGenerateFlashcards } from "../graph/unit-session-stream.js";
import type { StreamTokenHandler } from "../llm/chat-stream.js";
import {
  type FlashCardDraft,
  type LearningMaterialContent,
} from "../llm/schemas.js";
import { computeFlashcardSourceHash } from "./source-hash.js";
import { boundFlashcardBudgets } from "./budget.js";

function normalizeFront(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function isDuplicateFront(front: string, seen: Set<string>): boolean {
  const key = normalizeFront(front);
  if (seen.has(key)) return true;
  seen.add(key);
  return false;
}

function flashcardBudget(target: {
  importance: string;
  difficulty: string;
  targetCognitiveLevel: string;
}): { min: number; max: number } {
  if (target.importance === "enrichment") return { min: 0, max: 1 };
  if (target.importance === "supporting") return { min: 1, max: 1 };
  const intensive =
    target.difficulty === "hard" ||
    ["analyze", "evaluate", "create"].includes(target.targetCognitiveLevel);
  return intensive ? { min: 2, max: 2 } : { min: 1, max: 2 };
}

function criteriaText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value
    .flatMap((criterion) => {
      if (typeof criterion === "string") return [criterion];
      if (
        criterion &&
        typeof criterion === "object" &&
        "text" in criterion &&
        typeof criterion.text === "string"
      ) {
        return [criterion.text];
      }
      return [];
    })
    .join("；");
}

function storedCriteriaText(value: string): string {
  try {
    return criteriaText(JSON.parse(value));
  } catch {
    return "";
  }
}

function enrichAnchorFromMaterial(
  draft: FlashCardDraft,
  material: LearningMaterialContent,
): FlashCardDraft {
  if (!draft.anchor) return draft;
  const anchor = { ...draft.anchor };
  if (anchor.scope === "block" && anchor.blockIndex != null) {
    const block = material.blocks[anchor.blockIndex];
    if (block) {
      anchor.blockKey = computeBlockKey(block, anchor.blockIndex);
      anchor.blockType = block.type;
      anchor.highlightKey = anchor.highlightKey ?? `block:${anchor.blockIndex}`;
    }
  }
  return { ...draft, anchor };
}

function isValidAnchor(
  draft: FlashCardDraft,
  material: LearningMaterialContent,
): boolean {
  const anchor = draft.anchor;
  if (!anchor) return true;
  if (anchor.scope === "introduction") return material.introduction.length > 0;
  if (anchor.scope === "key_takeaway") {
    const i = anchor.takeawayIndex ?? 0;
    return i >= 0 && i < material.keyTakeaways.length;
  }
  if (anchor.scope === "block") {
    return resolveBlockIndex(material, anchor as MaterialAnchor) != null;
  }
  if (anchor.scope === "cornell_cue") return true;
  return false;
}

export async function generateFlashcardDeckForUnit(
  repository: FlashcardExperienceRepository,
  unitId: string,
  userId: string,
  options?: { onToken?: StreamTokenHandler; signal?: AbortSignal },
) {
  const unit = await repository.findGenerationContext(userId, unitId);
  if (!unit) throw new Error("Unit not found");
  const material = parseLearningMaterial(unit.material);
  const seenEntities = new Set<string>();
  const memoryAnchors = unit.anchors
    .flatMap((anchor) => {
      if (seenEntities.has(anchor.cognitiveEntityId)) return [];
      seenEntities.add(anchor.cognitiveEntityId);
      return [
        {
          localRef: "",
          entityId: anchor.cognitiveEntityId,
          entityTitle: anchor.entityTitle,
          targetTitle: anchor.targetTitle,
          learningObjective: anchor.learningObjective,
          criteria: storedCriteriaText(anchor.assessmentCriteria),
          budget: flashcardBudget(anchor),
        },
      ];
    })
    .map((anchor, index) => ({ ...anchor, localRef: `lt_${index + 1}` }))
    .slice(0, 15);
  if (memoryAnchors.length === 0) {
    throw new Error("Memory evidence anchors required");
  }
  const boundedBudgets = boundFlashcardBudgets(
    memoryAnchors.map((anchor) => anchor.budget),
  );
  memoryAnchors.forEach((anchor, index) => {
    anchor.budget = boundedBudgets[index];
  });
  const durableIdByLocalRef = new Map(
    memoryAnchors.map((anchor) => [anchor.localRef, anchor.entityId]),
  );
  const sourceHash = computeFlashcardSourceHash(material);
  const cardBudgetByAnchor = new Map(
    memoryAnchors.map((anchor) => [anchor.localRef, anchor.budget]),
  );
  const target = memoryAnchors.reduce(
    (sum, anchor) => {
      const budget = cardBudgetByAnchor.get(anchor.localRef)!;
      return { min: sum.min + budget.min, max: sum.max + budget.max };
    },
    { min: 0, max: 0 },
  );
  target.min = Math.max(1, target.min);
  target.max = Math.max(target.min, target.max);

  const materialJson = serializeLearningMaterialForQuiz(material);

  const generated = await streamGenerateFlashcards(
    {
      id: unit.goal.id,
      title: unit.goal.title,
      level: unit.goal.level,
      contentLanguage: unit.goal.contentLanguage,
      generationOptions: unit.goal.generationOptions,
      userId,
    },
    unitId,
    unit.unit.title,
    materialJson,
    target,
    {
      cornellCues: unit.cornellCues ?? undefined,
      learningTargetsBlock: memoryAnchors
        .map(
          (anchor) =>
            `[${anchor.localRef}] Cognitive entity: ${anchor.entityTitle}\nGoal: ${anchor.targetTitle}\nLearning objective: ${anchor.learningObjective}\nCriteria: ${anchor.criteria}\nFlashcards: ${anchor.budget.min}–${anchor.budget.max}`,
        )
        .join("\n\n"),
    },
    options?.onToken,
    options?.signal,
  );

  const seen = new Set<string>();
  const countByAnchor = new Map<string, number>();
  const merged: FlashCardDraft[] = [];
  for (const draft of generated.cards) {
    if (isDuplicateFront(draft.front, seen)) continue;
    const localRef = draft.learningTargetIds[0];
    if (!durableIdByLocalRef.has(localRef)) continue;
    const pointCount = countByAnchor.get(localRef) ?? 0;
    const pointBudget = cardBudgetByAnchor.get(localRef);
    if (!pointBudget || pointCount >= pointBudget.max) continue;
    const enriched = enrichAnchorFromMaterial(draft, material);
    if (!isValidAnchor(enriched, material)) continue;
    merged.push(enriched);
    countByAnchor.set(localRef, pointCount + 1);
    if (merged.length >= target.max) break;
  }

  const now = new Date();
  const cards = merged.map((draft, sortOrder) => {
    const fsrs = createInitialFsrsState(now);
    const excerpt =
      draft.sourceExcerpt ||
      (draft.anchor
        ? anchorContextSnippet(material, draft.anchor as MaterialAnchor)
        : "");
    const localRef = draft.learningTargetIds[0];
    return {
      front: draft.front,
      back: draft.back,
      cognitiveEntityId: durableIdByLocalRef.get(localRef)!,
      anchorJson: JSON.stringify(draft.anchor ?? {}),
      sourceExcerpt: excerpt.slice(0, 2000),
      sortOrder,
      due: fsrs.due,
      stability: fsrs.stability,
      difficulty: fsrs.difficulty,
      elapsedDays: fsrs.elapsedDays,
      scheduledDays: fsrs.scheduledDays,
      reps: fsrs.reps,
      lapses: fsrs.lapses,
      state: fsrs.state,
      lastReview: fsrs.lastReview,
    };
  });
  const deck = await repository.replaceGeneratedDeck({
    userId,
    unitId,
    sourceHash,
    generatedAt: now,
    cards,
  });

  return { deckId: deck.deckId, cardCount: merged.length, sourceHash };
}

export async function getUnitFlashcardDeck(
  repository: FlashcardExperienceRepository,
  unitId: string,
  userId: string,
) {
  const deck = await repository.getUnitDeck(userId, unitId);
  if (!deck) return null;
  const material = deck.material ? parseLearningMaterial(deck.material) : null;
  const currentHash = material ? computeFlashcardSourceHash(material) : "";
  const stale = Boolean(
    currentHash && deck.sourceHash && currentHash !== deck.sourceHash,
  );

  return {
    id: deck.id,
    unitId: deck.unitId,
    cardCount: deck.cardCount,
    generatedAt: deck.generatedAt.toISOString(),
    sourceHash: deck.sourceHash,
    stale,
    stats: {
      due: deck.stats.due,
      new: deck.stats.newCount,
      learning: deck.stats.learning,
      total: deck.stats.total,
    },
  };
}
