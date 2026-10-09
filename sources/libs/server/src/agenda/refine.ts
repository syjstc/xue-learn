import { z } from "zod";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { buildAgendaRefineInvocationPrompt } from "../learning-systems/capabilities/agenda.js";
import {
  getLanguagePromptInstruction,
  type ContentLanguageCode,
} from "../llm/content-language.js";
import type { DeterministicAgenda, PlannedAgendaItem } from "./types.js";
import { hashAgendaContent } from "./types.js";

const refineItemSchema = z.object({
  unitId: z.string(),
  sectionId: z.string().nullable().optional(),
  plannedDate: z.string(),
  priority: z.number().int(),
  explanation: z.string().max(240),
});

export const agendaRefineSchema = z.object({
  items: z.array(refineItemSchema).max(40),
});

export type AgendaRefineResult = z.infer<typeof agendaRefineSchema>;

export function buildRefineInvocation(
  agenda: DeterministicAgenda,
  locale: ContentLanguageCode,
) {
  const shortlist = [...agenda.items]
    .sort(
      (left, right) =>
        left.plannedDate.localeCompare(right.plannedDate) ||
        left.sortIndex - right.sortIndex ||
        left.unitId.localeCompare(right.unitId) ||
        (left.sectionId ?? "").localeCompare(right.sectionId ?? ""),
    )
    .map((item) => ({
      unitId: item.unitId,
      goalId: item.goalId,
      goalTitle: item.goalTitle,
      unitTitle: item.unitTitle,
      sectionId: item.sectionId ?? null,
      sectionTitle: item.sectionTitle ?? null,
      itemType: item.itemType,
      plannedDate: item.plannedDate,
      estimatedMinutes: item.estimatedMinutes,
      priority: item.priority,
      explanationCode: item.explanationCode,
    }));
  return {
    capacityMinutes: agenda.capacityMinutes,
    planningDate: agenda.planningDate,
    timezone: agenda.timezone,
    languageInstruction: getLanguagePromptInstruction(locale),
    shortlist,
  };
}

/**
 * Validate LLM refine output against deterministic constraints.
 * Returns refined agenda or null if invalid.
 */
export function validateAgendaRefine(
  base: DeterministicAgenda,
  refined: AgendaRefineResult,
): DeterministicAgenda | null {
  if (refined.items.length !== base.items.length) return null;
  const identity = (item: { unitId: string; sectionId?: string | null }) =>
    `${item.unitId}:${item.sectionId ?? "unit"}`;
  const baseByUnit = new Map(base.items.map((item) => [identity(item), item]));
  const seen = new Set<string>();
  const dayTotals = new Map<string, number>();
  const nextItems: PlannedAgendaItem[] = [];

  const sorted = [...refined.items].sort((a, b) => b.priority - a.priority);
  let sortIndex = 0;
  for (const row of sorted) {
    const key = identity(row);
    if (seen.has(key)) return null;
    seen.add(key);
    const baseItem = baseByUnit.get(key);
    if (!baseItem) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.plannedDate)) return null;
    if (row.plannedDate < base.planningDate) return null;
    const dayTotal =
      (dayTotals.get(row.plannedDate) ?? 0) + baseItem.estimatedMinutes;
    const dayCapacity =
      base.capacityByDate?.[row.plannedDate] ?? base.capacityMinutes;
    if (dayTotal > dayCapacity + 5) return null;
    dayTotals.set(row.plannedDate, dayTotal);
    nextItems.push({
      ...baseItem,
      plannedDate: row.plannedDate,
      priority: row.priority,
      explanation: row.explanation.trim() || baseItem.explanation,
      sortIndex: sortIndex++,
    });
  }

  if (seen.size !== base.items.length) return null;

  return {
    ...base,
    items: nextItems,
    contentHash: hashAgendaContent({
      planningDate: base.planningDate,
      capacityMinutes: base.capacityMinutes,
      capacityByDate: base.capacityByDate ?? {},
      items: nextItems,
    }),
  };
}

export async function refineAgendaWithLlm(
  agenda: DeterministicAgenda,
  options: {
    userId: string;
    locale: ContentLanguageCode;
    timeoutMs?: number;
  },
): Promise<DeterministicAgenda | null> {
  if (agenda.items.length === 0) return null;
  try {
    const timeoutMs = options.timeoutMs ?? 12_000;
    const result = await Promise.race([
      runValidatedStructuredGeneration({
        mode: "object",
        schema: agendaRefineSchema,
        prompt: buildAgendaRefineInvocationPrompt(
          buildRefineInvocation(agenda, options.locale),
        ),
        options: {
          operation: "agenda.refine",
          bindingSchema: agendaRefineSchema,
          meta: { userId: options.userId },
        },
        contextSubject: { userId: options.userId },
        contextQuery:
          "Refine this learner's current deterministic Today+7 study agenda.",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("agenda.refine timeout")), timeoutMs),
      ),
    ]);
    return validateAgendaRefine(agenda, result);
  } catch {
    return null;
  }
}
