// Private Cornell prompt source owned by unit-content capability.
import type { PlanContext } from "../../../llm/context/plan-context.js";

type CornellPromptPlan =
  | { plan: PlanContext }
  | {
      goalBlock: string;
      difficultyBlock: string;
      timeBudgetBlock: string;
      styleBlock: string;
      languageBlock: string;
    };

/** Root JSON-array successor to Cornell line DSL. */
export function buildCornellJsonPrompt(
  params: {
    unitTitle: string;
    optionsBlock: string;
    sqJson: string;
    materialJson: string;
    context: string;
  } & CornellPromptPlan,
): string {
  const blocks =
    "plan" in params
      ? {
          goalBlock: params.plan.goalBlock(),
          difficultyBlock: params.plan.difficultyBlock(),
          timeBudgetBlock: params.plan.timeBudgetBlock(),
          styleBlock: params.plan.styleBlock(),
          languageBlock: params.plan.languageBlock(),
        }
      : params;
  return `Generate study notes for "${params.unitTitle}" after the learner read the material.
Return note items first, then recall-cue items, then exactly one summary item.
Notes are distilled study notes rather than a copy of the textbook. The summary is a 2-4 sentence synthesis.
${blocks.goalBlock}
${blocks.difficultyBlock}
${blocks.timeBudgetBlock}
${blocks.styleBlock}
${params.optionsBlock ? `\n${params.optionsBlock}\n` : ""}${blocks.languageBlock}

Item contract:
- {"kind":"note","text":"distilled note"}
- {"kind":"cue","text":"recall cue"}
- {"kind":"summary","text":"2-4 sentence synthesis"}

SQ preview: ${params.sqJson}
Learning material: ${params.materialJson}
Context:
${params.context}`;
}
