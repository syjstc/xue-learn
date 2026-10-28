import { tBackend } from "../../../common/src/index.js";
import type { UnitSubdivisionRepository, UnitSubdivisionStatusRecord } from "../../../domain/src/index.js";
import { invalidateAgendaForUser } from "../agenda/index.js";
import { buildSubdivisionScopePrompt } from "../domain/unit-map-context.js";
import type { StreamTokenHandler } from "../llm/chat-stream.js";
import { resolveGoalContentLanguage } from "../llm/content-language.js";
import { mergeRegenerationAdjustment } from "../llm/generation-options.js";
import type { MapDslPartial } from "../llm/map-dsl.js";
import { subdivideUnit } from "../llm/subdivide.js";
import { appendLearnerProfileToPromptOptions } from "../persona/learner-profile.js";
import { retrieveContextForUnit } from "../rag/retrieve.js";

export type SubdivisionMode = "structural" | "steps";
export type RequestedSubdivisionMode = SubdivisionMode | "auto";
export type SubdivideProgress = (message: string) => void;
export type SubdivideStreamOptions = { onToken?: StreamTokenHandler; onPartialMap?: (partial: MapDslPartial) => void | Promise<void>; signal?: AbortSignal; adjustment?: string };
export type SubdivisionStatus = Omit<UnitSubdivisionStatusRecord, "goalId" | "userId" | "goalTitle" | "contentLanguage" | "generationOptions" | "cognitiveModelVersion" | "mappings" | "title" | "contentSummary">;
export type ForceSubdivideResult = { mode: SubdivisionMode; parentUnitId: string; childCount: number; children: { id: string; title: string }[]; steps: SubdivisionStatus["steps"] };

export class SubdivideUnitError extends Error {
  constructor(message: string, readonly code: "not_found" | "already_module" | "max_depth" | "module_container" | "no_children" | "unsafe_activity" | "module_limit" | "no_targets") { super(message); this.name = "SubdivideUnitError"; }
}
export function localizeSubdivideUnitError(error: SubdivideUnitError): string {
  switch (error.code) {
    case "not_found": return tBackend("error.learning.subdivideNotFound");
    case "already_module": return tBackend("error.learning.subdivideAlreadyModule");
    case "max_depth": return tBackend("error.learning.subdivideMaxDepth");
    case "module_container": return tBackend("error.learning.subdivideModuleContainer");
    case "no_children": return tBackend("error.learning.subdivideNoChildren");
    case "unsafe_activity": return tBackend("error.learning.subdivideUnsafeActivity");
    case "module_limit": return tBackend("error.learning.subdivideModuleLimit", { limit: 20 });
    case "no_targets": return tBackend("error.learning.subdivideNoTargets");
  }
}
function failure(status: Exclude<Awaited<ReturnType<UnitSubdivisionRepository["applyStructural"]>>, { status: "applied" }>): never { const code = status.status; throw new SubdivideUnitError(code === "module_limit" ? "拆分后模块课程数不能超过 20" : code, code); }
function publicStatus(value: UnitSubdivisionStatusRecord): SubdivisionStatus { const { goalId: _g, userId: _u, goalTitle: _gt, contentLanguage: _cl, generationOptions: _go, cognitiveModelVersion: _v, mappings: _m, title: _t, contentSummary: _s, ...status } = value; return status; }
export async function getSubdivisionStatus(unitId: string, userId: string, repository: UnitSubdivisionRepository): Promise<SubdivisionStatus> { const status = await repository.getStatus(unitId, userId); if (!status) throw new SubdivideUnitError("单元不存在", "not_found"); return publicStatus(status); }

async function generateChildren(unit: UnitSubdivisionStatusRecord, onProgress?: SubdivideProgress, options?: SubdivideStreamOptions) {
  onProgress?.(tBackend("status.generation.subdivide", { title: unit.title }));
  const [mapScope, context, generationOptions] = await Promise.all([
    buildSubdivisionScopePrompt(unit.unitId),
    retrieveContextForUnit(unit.goalId, unit.title, unit.contentSummary || unit.title),
    appendLearnerProfileToPromptOptions(unit.userId, mergeRegenerationAdjustment(unit.generationOptions, options?.adjustment, "User adjustment request for sub-map regeneration") || undefined),
  ]);
  return subdivideUnit({ goalTitle: unit.goalTitle, unitTitle: unit.title, contentSummary: unit.contentSummary || unit.title, contentLanguage: resolveGoalContentLanguage(unit.contentLanguage, unit.goalTitle), context: context || undefined, mapScope: mapScope || undefined, generationOptions, onToken: options?.onToken, onPartialMap: options?.onPartialMap, signal: options?.signal });
}

async function applyGenerated(repository: UnitSubdivisionRepository, unit: UnitSubdivisionStatusRecord, children: Array<{ title: string; difficulty: string; contentSummary: string }>, mode: SubdivisionMode, replaceExisting: boolean, adjustment: string): Promise<ForceSubdivideResult> {
  const result = mode === "steps" ? await repository.saveSteps({ unitId: unit.unitId, children, adjustment }) : await repository.applyStructural({ unitId: unit.unitId, children, replaceExisting });
  if (result.status !== "applied") failure(result);
  if (result.mode === "structural") await invalidateAgendaForUser(result.userId);
  return { mode: result.mode, parentUnitId: result.parentUnitId, childCount: result.children.length, children: result.children, steps: result.steps };
}

export async function forceSubdivideUnit(unitId: string, repository: UnitSubdivisionRepository, onProgress?: SubdivideProgress, options?: SubdivideStreamOptions, requestedMode: RequestedSubdivisionMode = "auto"): Promise<ForceSubdivideResult> {
  const unit = await repository.getStatus(unitId); if (!unit) throw new SubdivideUnitError("单元不存在", "not_found");
  const mode = requestedMode === "auto" ? unit.recommendedMode : requestedMode;
  if (mode === "structural" && !unit.structuralEligible) throw new SubdivideUnitError("本单元不满足安全结构拆分条件，请使用学习步骤模式", unit.structuralReason === "module_limit" ? "module_limit" : unit.structuralReason === "no_targets" ? "no_targets" : unit.structuralReason === "max_depth" ? "max_depth" : "unsafe_activity");
  const generated = await generateChildren(unit, onProgress, options);
  onProgress?.(mode === "steps" ? tBackend("status.generation.saveLearningSteps") : tBackend("status.generation.subdivideWriting", { count: generated.children.length }));
  return applyGenerated(repository, unit, generated.children, mode, false, options?.adjustment ?? "");
}

export async function regenerateSubMap(unitId: string, repository: UnitSubdivisionRepository, onProgress?: SubdivideProgress, options?: SubdivideStreamOptions, requestedMode: RequestedSubdivisionMode = "auto"): Promise<ForceSubdivideResult> {
  const unit = await repository.getStatus(unitId); if (!unit) throw new SubdivideUnitError("单元不存在", "not_found");
  const mode = requestedMode === "auto" ? (unit.hasStructuralSubmap ? "structural" : "steps") : requestedMode;
  if (mode === "structural" && !unit.structuralEligible) throw new SubdivideUnitError("子单元已有学习活动，不能重写结构", unit.structuralReason === "module_limit" ? "module_limit" : unit.structuralReason === "no_targets" ? "no_targets" : "unsafe_activity");
  const generated = await generateChildren(unit, onProgress, options);
  return applyGenerated(repository, unit, generated.children, mode, unit.hasStructuralSubmap, options?.adjustment ?? "");
}

export async function removeSubMap(unitId: string, repository: UnitSubdivisionRepository) { const result = await repository.remove(unitId); if (result.status !== "applied") failure(result); if (result.mode === "structural") await invalidateAgendaForUser(result.userId); return { unitId, mode: result.mode }; }
