import type { LearningSystemPersistenceClient } from "../persistence-client.js";
import type { LearningSystemCapability } from "../types.js";
import {
  OPTIONAL_CONTEXT_VIEW_KEYS,
  VERSION,
  envelope,
} from "./support/optional.js";

export const SCENARIO_THEATER_GENERATION_VIEW_KEYS = Object.freeze({
  prepareInstructionContext: "instruction.scenario_theater.prepare.v1",
  sceneInstructionContext: "instruction.scenario_theater.scene.v1",
  finalizeInstructionContext: "instruction.scenario_theater.finalize.v1",
});

function generationPrompt(key: string, invocation: unknown): string | null {
  const input = invocation as
    | {
        context?: string;
        claimed?: unknown;
        definition?: unknown;
        backgroundPrompt?: string;
        narrationVoice?: string;
        fallback?: unknown;
      }
    | undefined;
  if (
    key === SCENARIO_THEATER_GENERATION_VIEW_KEYS.prepareInstructionContext &&
    input?.context
  ) {
    return `Prepare the opening setup and cast for an adult scenario exercise in XueLearn, an AI self-study assistant.
This is a low-latency preparation step. Do not author scenes, choices, endings, ids, routes, acts, or numeric effects; scenes are generated just in time during play and the server freezes the route.

Requirements:
- Return only a title, short premise, learner role, objective, theme, one background key, 2–4 characters, and 2–3 meter labels.
- Choose the best background key from the course topic and the workplace/setting described in the premise. The server uses it for every scene; return only the key, not image, color, lighting, or overlay descriptions.
Available keys and setting guidance:
${input.backgroundPrompt ?? ""}
- Do not default to workspace or workshop; the background must fit the premise's real environment.
- Each character must include gender (male/female) and ageGroup (young_adult/middle_aged/older_adult), chosen plausibly for the role.
- Design story characters only; do not add a coach. The server supplies the learner's selected teaching persona separately.
- Do not choose or describe image assets; the server deterministically assigns matching art from name, gender, and age group.
- This is a realistic task simulation, not a dialogue rewrite of the lesson. The learner must perform a concrete work/life task in character—diagnose, operate, communicate, make, sequence, verify, or recover—and own the outcome.
- The premise must include a credible place/work setting, trigger event, real constraints, and stakes. The objective must be observable task performance, never "learn", "understand", "master", or "practice" a topic.
- Characters need distinct responsibilities, incentives, and information gaps that create realistic collaboration or trade-offs. They know nothing about the course and must never act as teacher, coach, examiner, or quiz host.
- Meters must represent real stakes such as time, budget, quality, trust, safety, or customer impact—not mastery, answer correctness, or learning progress.
- Write for adults: concrete, concise, and scene-ready.

Course context:
${input.context}`;
  }
  if (
    key === SCENARIO_THEATER_GENERATION_VIEW_KEYS.sceneInstructionContext &&
    input?.context &&
    input.claimed
  ) {
    const claimed = input.claimed as unknown[];
    return `Author adult visual-novel scenes for XueLearn's scenario theater. Return only the structured object.
Return exactly ${claimed.length} scenes in the input order, with exactly 2 choices per scene. Do not emit ids or change routes, acts, effects, or numeric values.

For each scene:
- Do not return background. The server froze one background for the whole story.
- Return 6–10 beats in playback order.
- Dialogue uses speakerIndex from the frozen cast. Include at least 2 dialogue beats in which characters genuinely respond and move the situation forward.
- When a character directly addresses the learner, set addressee to "learner" and use natural second-person wording. Never use a personal name or the {{learnerName}} placeholder. Do not set addressee for character-to-character dialogue.
- Narration has no speakerIndex and tone must be setup, observation, or transition.
- Narration is camera/stage direction: show observable setting, action, time change, and choice consequences. Even when voiced by the learner's teaching persona, it must not become a coach, explain, hint, ask a teaching question, summarize principles, or evaluate the learner.
- Keep each beat natural and under about 90 characters in the target language; do not pack multiple dialogue turns into one beat.
- Characters speak only from their role and incentives. They do not know this is a course; they must not test concepts, request explanations, mention applying the lesson, praise/correct the learner, or use Socratic questions to lead to an answer.
- Every scene must force practical application: inspect clues, choose a tool/method, sequence actions, draft a concrete reply, operate an object, allocate resources, verify a result, or handle an exception. Do not reduce application to selecting a concept.
- Choice labels must be concrete actions or words the learner can execute now, with real trade-offs. Avoid abstract options such as "follow the correct principle" or "take a risk". Consequences must visibly change people, process, data, resources, or setting—not announce right/wrong.
- Reflection is only for intermission/end debrief. Explain causal links among action, constraints, and outcome without lecture tone; do not say "correct", "wrong", "you should", or "this demonstrates a knowledge point".
- Never use out-of-story teaching language such as "this lesson", "course", "knowledge point", "learning goal", "correct answer", "mastery", "review", "teacher", or "coach".

Narration voice (changes wording only; never grants a coach role):
${input.narrationVoice ?? ""}

Frozen route plan:
${JSON.stringify(input.fallback)}

Course context:
${input.context}

Claimed scenes:
${JSON.stringify(input.claimed)}`;
  }
  if (
    key === SCENARIO_THEATER_GENERATION_VIEW_KEYS.finalizeInstructionContext &&
    input?.definition
  ) {
    return `Audit the adult scenario exercise below. Check factual accuracy, choice trade-offs, consequence coherence, safety, and adult suitability. Treat realism as a hard gate: characters must stay in role; they must not lecture, test concepts, hint at knowledge, or use Socratic questions to lead the answer. Narration may show only setting, action, time, and consequences; it must not analyze or advise as a coach. Each choice must be a concrete executable action or utterance, and its consequence must be visible in people, process, data, resources, or setting. Replace any out-of-story teaching language such as "this lesson", "course", "knowledge point", "learning goal", "correct answer", "mastery", "review", "teacher", or "coach".
Return only one JSON object with this exact contract:
- approved: boolean. Use true only when the original exercise needs no changes.
- issues: an array of objects shaped {"sceneId":"optional existing scene id","problem":"concise problem"}. Never return issue strings.
- replacements: an array containing only the smallest necessary typed replacements:
  - {"kind":"setup","field":"title|premise|learnerRole|objective","text":"complete replacement text"}
  - {"kind":"scene_beats","sceneId":"existing scene id","beats":[6–10 complete beats]}
  - {"kind":"choice","sceneId":"existing scene id","choiceId":"existing choice id","label":"complete label","consequence":"complete consequence","reflection":"complete reflection"}
  - {"kind":"ending","endingId":"existing ending id","title":"complete title","summary":"complete summary","coachDebrief":"complete debrief"}
For a scene_beats replacement, each beat is either {"kind":"dialogue","speakerIndex":0,"text":"...","addressee":"learner"} or {"kind":"narration","tone":"setup|observation|transition","text":"..."}; addressee is optional and allowed only for dialogue. speakerIndex is the zero-based index in the frozen characters array.
Use an empty replacements array when no text needs repair. Do not return a keyed patch object, dotted paths, replacement indexes, markdown, or fields outside this contract. Replace only problematic text; preserve every existing identifier and never change routes, acts, effects, meters, backgrounds, characters, or numeric values. Dialogue addressed to the learner must retain addressee: "learner" while using neutral second-person wording; never add a personal name or the {{learnerName}} placeholder.

${JSON.stringify(input.definition)}`;
  }
  return null;
}

async function ownedUnit(
  persistence: LearningSystemPersistenceClient,
  subject: import("../types.js").LearningSystemSubject,
) {
  if (!subject.userId || !subject.unitId) return null;
  return persistence.learningUnit.findFirst({
    where: {
      id: subject.unitId,
      goal: {
        userId: subject.userId,
        ...(subject.goalId ? { id: subject.goalId } : {}),
      },
    },
    select: { id: true, goalId: true },
  });
}

export function createScenarioTheaterCapability(
  persistence: LearningSystemPersistenceClient,
): LearningSystemCapability {
  const capabilityId = "scenario-theater";
  return {
    manifest: {
      id: capabilityId,
      version: VERSION,
      kind: "learning_system",
      providesViews: [
        OPTIONAL_CONTEXT_VIEW_KEYS.scenarioTheaterCurrent,
        ...Object.values(SCENARIO_THEATER_GENERATION_VIEW_KEYS),
      ],
    },
    getView: async (request) => {
      const promptBlock = generationPrompt(request.key, request.invocation);
      if (promptBlock) {
        return envelope({
          ownerCapabilityId: capabilityId,
          authority: "server_policy",
          scope: request.subject,
          data: { promptBlock },
        });
      }
      if (
        request.key !== OPTIONAL_CONTEXT_VIEW_KEYS.scenarioTheaterCurrent ||
        !request.subject.userId ||
        !request.subject.unitId ||
        !(await ownedUnit(persistence, request.subject))
      ) {
        return null;
      }
      const [theater, run] = await Promise.all([
        persistence.unitScenarioTheater.findUnique({
          where: { unitId: request.subject.unitId },
          select: {
            id: true,
            revision: true,
            status: true,
            recommended: true,
            recommendation: true,
            updatedAt: true,
          },
        }),
        persistence.scenarioTheaterRun.findFirst({
          where: {
            userId: request.subject.userId,
            unitId: request.subject.unitId,
          },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            status: true,
            currentSceneId: true,
            endingId: true,
            updatedAt: true,
          },
        }),
      ]);
      return envelope({
        ownerCapabilityId: capabilityId,
        authority: "conversation_context",
        scope: request.subject,
        asOf:
          run && theater && run.updatedAt > theater.updatedAt
            ? run.updatedAt
            : (theater?.updatedAt ?? run?.updatedAt),
        data: {
          available: Boolean(theater),
          theater: theater
            ? {
                id: theater.id,
                revision: theater.revision,
                status: theater.status,
                recommended: theater.recommended,
                recommendation: theater.recommendation,
              }
            : null,
          resumableRun: run
            ? {
                id: run.id,
                status: run.status,
                currentSceneId: run.currentSceneId,
                endingId: run.endingId,
              }
            : null,
        },
      });
    },
  };
}
