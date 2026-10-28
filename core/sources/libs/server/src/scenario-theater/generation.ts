import { createHash } from "node:crypto";
import { z } from "zod";
import { tBackend } from "../../../common/src/index.js";
import type { ScenarioTheaterGenerationRepository, ScenarioTheaterRecord } from "../../../domain/src/index.js";
import { sqPreviewResponseSchema } from "../llm/schemas.js";
import { runValidatedStructuredGeneration } from "../llm/validated-structured-generation.js";
import { parseJson } from "../utils.js";
import { getAggregatedUnitMaterial } from "../sections/index.js";
import { resolveTeachingPersona } from "../teaching-personas/index.js";
import {
  scenarioTheaterDefinitionSchema,
  scenarioTheaterDefinitionV2Schema,
  type ScenarioTheaterDefinition,
  type ScenarioTheaterDefinitionV2,
} from "./schema.js";

type Client = ScenarioTheaterGenerationRepository;
type Progress = (phase: string, message: string) => void | Promise<void>;

export const SCENARIO_THEATER_PREPARE_EVENT = "unit.scenario_theater.prepare";
export const SCENARIO_THEATER_SCENE_PREFETCH_EVENT =
  "unit.scenario_theater.scene.prefetch";
export const SCENARIO_THEATER_FINALIZE_EVENT = "unit.scenario_theater.finalize";

type Destination =
  { kind: "scene"; index: number } | { kind: "ending"; index: number };

type TemplateScene = {
  act: 1 | 2 | 3;
  destinations: [Destination, Destination];
  choiceRoles: [
    "helpful" | "costly" | "recovery",
    "helpful" | "costly" | "recovery",
  ];
};

type TheaterTemplate = {
  id: "compact_5_6" | "standard_6_8";
  scenes: TemplateScene[];
};

const ending = (index: number): Destination => ({ kind: "ending", index });
const scene = (index: number): Destination => ({ kind: "scene", index });

export const SCENARIO_THEATER_TEMPLATES: Record<
  TheaterTemplate["id"],
  TheaterTemplate
> = {
  compact_5_6: {
    id: "compact_5_6",
    scenes: [
      {
        act: 1,
        destinations: [scene(1), scene(2)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(3), scene(4)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(4), scene(5)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 1,
        destinations: [scene(6), scene(7)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(7), scene(8)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(8), scene(6)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 2,
        destinations: [scene(9), scene(10)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 2,
        destinations: [scene(10), scene(11)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 2,
        destinations: [scene(11), scene(9)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 3,
        destinations: [ending(0), scene(12)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 3,
        destinations: [ending(1), scene(12)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 3,
        destinations: [ending(2), scene(12)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 3,
        destinations: [ending(0), ending(1)],
        choiceRoles: ["recovery", "helpful"],
      },
    ],
  },
  standard_6_8: {
    id: "standard_6_8",
    scenes: [
      {
        act: 1,
        destinations: [scene(1), scene(2)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(3), scene(4)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(4), scene(5)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 1,
        destinations: [scene(6), scene(7)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 1,
        destinations: [scene(7), scene(8)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 1,
        destinations: [scene(8), scene(6)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 2,
        destinations: [scene(9), scene(10)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 2,
        destinations: [scene(10), scene(11)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 2,
        destinations: [scene(11), scene(9)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 2,
        destinations: [scene(12), scene(13)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 2,
        destinations: [scene(13), scene(14)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 2,
        destinations: [scene(14), scene(12)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 3,
        destinations: [ending(0), scene(15)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 3,
        destinations: [ending(1), scene(15)],
        choiceRoles: ["recovery", "costly"],
      },
      {
        act: 3,
        destinations: [scene(15), scene(16)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 3,
        destinations: [ending(1), scene(17)],
        choiceRoles: ["helpful", "costly"],
      },
      {
        act: 3,
        destinations: [ending(2), scene(17)],
        choiceRoles: ["costly", "recovery"],
      },
      {
        act: 3,
        destinations: [ending(0), ending(2)],
        choiceRoles: ["recovery", "costly"],
      },
    ],
  },
};

const avatarSchema = z.enum(["mentor", "peer", "client", "expert", "system"]);
const genderSchema = z.enum(["male", "female"]);
const ageGroupSchema = z.enum(["young_adult", "middle_aged", "older_adult"]);
const themeSchema = z.enum([
  "office",
  "technical",
  "conversation",
  "field",
  "generic",
]);
const backgroundSchema = z.enum([
  "briefing",
  "workspace",
  "conversation",
  "incident",
  "outcome",
  "technical_lab",
  "workshop",
  "meeting_room",
  "field_site",
  "customer_lounge",
]);

const SCENARIO_THEATER_BACKGROUND_GUIDANCE = [
  {
    key: "briefing",
    description:
      "Briefing, task assignment, group explanation, or training kickoff",
  },
  {
    key: "workspace",
    description:
      "Focused desk work, document handling, or individual/small-team collaboration",
  },
  {
    key: "conversation",
    description:
      "Neutral one-to-one or small-group conversation without a strong business/customer frame",
  },
  {
    key: "incident",
    description:
      "Unexpected failure, emergency handling, or an operational response under time pressure",
  },
  {
    key: "outcome",
    description:
      "Outcome review, delivery acceptance, closing reflection, or summary",
  },
  {
    key: "technical_lab",
    description:
      "Software, engineering, technical troubleshooting, experimentation, or verification",
  },
  {
    key: "workshop",
    description:
      "Hands-on making, cooking/baking, repair/assembly, or practical demonstration",
  },
  {
    key: "meeting_room",
    description:
      "Planning, review, stand-up, or group decision-making in a meeting room",
  },
  {
    key: "field_site",
    description:
      "Outdoor, community, construction, storefront, inspection, or other field setting",
  },
  {
    key: "customer_lounge",
    description:
      "Service or consultation meeting with a customer, user, or client",
  },
] as const satisfies ReadonlyArray<{
  key: z.infer<typeof backgroundSchema>;
  description: string;
}>;

function formatScenarioTheaterBackgroundPrompt() {
  return SCENARIO_THEATER_BACKGROUND_GUIDANCE.map(
    (item) => `  · ${item.key} — ${item.description}`,
  ).join("\n");
}
const effectSchema = z.enum(["none", "fade", "pulse", "shake", "success"]);
const narrationToneSchema = z.enum(["setup", "observation", "transition"]);

const preparedSetupSchema = z.object({
  title: z.string().min(1),
  premise: z.string().min(1),
  learnerRole: z.string().min(1),
  objective: z.string().min(1),
  theme: themeSchema,
  background: backgroundSchema,
  characters: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().min(1),
        gender: genderSchema,
        ageGroup: ageGroupSchema,
      }),
    )
    .min(2)
    .max(4),
  meterLabels: z.array(z.string().min(1)).min(2).max(3),
});

const preparedPlanSchema = preparedSetupSchema.extend({
  scenes: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string().min(1),
      speakerIndex: z.number().int().optional(),
      background: backgroundSchema,
      effect: effectSchema,
      choices: z.array(
        z.object({
          label: z.string().min(1),
          consequenceBrief: z.string().min(1),
          learningPoint: z.string().min(1),
        }),
      ),
    }),
  ),
  endings: z.array(
    z.object({
      title: z.string().min(1),
      summary: z.string().min(1),
      coachDebrief: z.string().min(1),
    }),
  ),
});

const authoredSceneBatchSchema = z.object({
  scenes: z.array(
    z.object({
      beats: z
        .array(
          z.discriminatedUnion("kind", [
            z.object({
              kind: z.literal("dialogue"),
              speakerIndex: z.number().int().min(0),
              text: z.string().min(1),
              addressee: z.literal("learner").optional(),
            }),
            z.object({
              kind: z.literal("narration"),
              tone: narrationToneSchema,
              text: z.string().min(1),
            }),
          ]),
        )
        .min(6)
        .max(10),
      choices: z.array(
        z.object({
          label: z.string().min(1),
          consequence: z.string().min(1),
          reflection: z.string().min(1),
        }),
      ),
    }),
  ),
});

const storedAuthoredSceneSchema = z.object({
  id: z.string().min(1),
  background: backgroundSchema.optional(),
  beats: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({
          kind: z.literal("dialogue"),
          speakerId: z.string().min(1),
          text: z.string().min(1),
          addressee: z.literal("learner").optional(),
        }),
        z.object({
          kind: z.literal("narration"),
          tone: narrationToneSchema,
          text: z.string().min(1),
        }),
      ]),
    )
    .min(6)
    .max(10),
  choices: z.array(
    z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      consequence: z.string().min(1),
      reflection: z.string().min(1),
    }),
  ),
});

const auditSchema = z.object({
  approved: z.boolean(),
  issues: z.array(
    z.object({
      sceneId: z.string().optional(),
      problem: z.string(),
    }),
  ),
  replacements: z.array(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("setup"),
        field: z.enum(["title", "premise", "learnerRole", "objective"]),
        text: z.string().min(1),
      }),
      z.object({
        kind: z.literal("scene_beats"),
        sceneId: z.string().min(1),
        beats: z
          .array(
            z.discriminatedUnion("kind", [
              z.object({
                kind: z.literal("dialogue"),
                speakerIndex: z.number().int().min(0),
                text: z.string().min(1),
                addressee: z.literal("learner").optional(),
              }),
              z.object({
                kind: z.literal("narration"),
                tone: narrationToneSchema,
                text: z.string().min(1),
              }),
            ]),
          )
          .min(6)
          .max(10),
      }),
      z.object({
        kind: z.literal("choice"),
        sceneId: z.string().min(1),
        choiceId: z.string().min(1),
        label: z.string().min(1),
        consequence: z.string().min(1),
        reflection: z.string().min(1),
      }),
      z.object({
        kind: z.literal("ending"),
        endingId: z.string().min(1),
        title: z.string().min(1),
        summary: z.string().min(1),
        coachDebrief: z.string().min(1),
      }),
    ]),
  ),
});

export function applyScenarioTheaterAudit(
  definition: ScenarioTheaterDefinitionV2,
  audit: z.infer<typeof auditSchema>,
) {
  let appliedCount = 0;
  let nextDefinition = definition;

  for (const replacement of audit.replacements) {
    if (replacement.kind === "setup") {
      const limits = {
        title: 80,
        premise: 500,
        learnerRole: 120,
        objective: 300,
      } as const;
      nextDefinition = {
        ...nextDefinition,
        [replacement.field]: clampText(
          replacement.text,
          nextDefinition[replacement.field],
          limits[replacement.field],
        ),
      };
      appliedCount += 1;
      continue;
    }

    if (replacement.kind === "ending") {
      const endingIndex = nextDefinition.endings.findIndex(
        (endingPlan) => endingPlan.id === replacement.endingId,
      );
      if (endingIndex < 0) continue;
      nextDefinition = {
        ...nextDefinition,
        endings: nextDefinition.endings.map((endingPlan, index) =>
          index === endingIndex
            ? {
                ...endingPlan,
                title: clampText(replacement.title, endingPlan.title, 80),
                summary: clampText(
                  replacement.summary,
                  endingPlan.summary,
                  700,
                ),
                coachDebrief: clampText(
                  replacement.coachDebrief,
                  endingPlan.coachDebrief,
                  1000,
                ),
              }
            : endingPlan,
        ),
      };
      appliedCount += 1;
      continue;
    }

    const sceneIndex = nextDefinition.scenes.findIndex(
      (scenePlan) => scenePlan.id === replacement.sceneId,
    );
    if (sceneIndex < 0) continue;
    const scenePlan = nextDefinition.scenes[sceneIndex]!;

    if (replacement.kind === "scene_beats") {
      nextDefinition = {
        ...nextDefinition,
        scenes: nextDefinition.scenes.map((candidate, index) =>
          index === sceneIndex
            ? {
                ...candidate,
                beats: replacement.beats.map((beat) =>
                  beat.kind === "dialogue"
                    ? {
                        kind: "dialogue" as const,
                        speakerId:
                          nextDefinition.characters[beat.speakerIndex]?.id ??
                          nextDefinition.characters[0]!.id,
                        text: clampText(beat.text, "局面仍在变化。", 240),
                        ...(beat.addressee
                          ? { addressee: beat.addressee }
                          : {}),
                      }
                    : {
                        kind: "narration" as const,
                        tone: beat.tone,
                        text: clampText(beat.text, "局面仍在变化。", 240),
                      },
                ),
              }
            : candidate,
        ),
      };
      appliedCount += 1;
      continue;
    }

    const choiceIndex = scenePlan.choices.findIndex(
      (choice) => choice.id === replacement.choiceId,
    );
    if (choiceIndex < 0) continue;
    nextDefinition = {
      ...nextDefinition,
      scenes: nextDefinition.scenes.map((candidate, index) =>
        index === sceneIndex
          ? {
              ...candidate,
              choices: candidate.choices.map((choice, candidateChoiceIndex) =>
                candidateChoiceIndex === choiceIndex
                  ? {
                      ...choice,
                      label: clampText(replacement.label, choice.label, 180),
                      consequence: clampText(
                        replacement.consequence,
                        choice.consequence,
                        500,
                      ),
                      reflection: clampText(
                        replacement.reflection,
                        choice.reflection,
                        500,
                      ),
                    }
                  : choice,
              ),
            }
          : candidate,
      ),
    };
    appliedCount += 1;
  }

  return {
    definition: scenarioTheaterDefinitionV2Schema.parse(nextDefinition),
    appliedCount,
  };
}

function parseSurvey(raw: string) {
  const parsed = sqPreviewResponseSchema.safeParse(
    parseJson<Record<string, unknown>>(raw, {}),
  );
  return parsed.success ? parsed.data : null;
}

function clampText(value: string | undefined, fallback: string, max: number) {
  const normalized = value?.trim() || fallback;
  return normalized.slice(0, max);
}

function fallbackPlan(params: {
  title: string;
  template: TheaterTemplate;
}): z.infer<typeof preparedPlanSchema> {
  return {
    title: `${params.title} · 情境实战`,
    premise: `一项与“${params.title}”有关的任务突然出现变化。你必须在有限信息、时间和资源下把它推进到可交付状态。`,
    learnerRole: "对任务结果负责的执行者",
    objective: "处理现场问题、作出可执行的取舍，并交付经得起现实检验的结果。",
    theme: "generic",
    background: "workshop",
    characters: [
      {
        name: "陈策",
        role: "任务协作者",
        gender: "male",
        ageGroup: "young_adult",
      },
      {
        name: "周宁",
        role: "项目负责人",
        gender: "female",
        ageGroup: "middle_aged",
      },
    ],
    meterLabels: ["任务进展", "决策质量"],
    scenes: params.template.scenes.map((item, index) => ({
      title:
        index === 0
          ? "任务开始"
          : item.act === 3
            ? "最后的取舍"
            : `局面变化 ${index}`,
      summary:
        index === 0
          ? "任务已经开始，现场信息、期限和相关人的诉求并不完全一致。"
          : "前一步的行动改变了现场条件，新的事实和限制已经出现。",
      speakerIndex: index % 2,
      background: "workspace",
      effect: "none",
      choices: item.choiceRoles.map((role) => ({
        label:
          role === "costly"
            ? "先按最快的方案推进，暂不处理已暴露的风险"
            : role === "recovery"
              ? "暂停当前动作，核对异常并调整执行方案"
              : "核对关键事实后，按可验证的步骤推进",
        consequenceBrief:
          role === "costly"
            ? "进度暂时加快，但未处理的风险很快影响了后续环节。"
            : role === "recovery"
              ? "异常被定位，相关人据此重新安排了资源，局面逐渐可控。"
              : "关键事实得到确认，下一环节获得了可以执行的输入。",
        learningPoint:
          role === "costly"
            ? "这一步省下了眼前的时间，却把风险转移给了后续环节。"
            : role === "recovery"
              ? "及时停下并根据新证据改动方案，避免了损失继续扩大。"
              : "可核验的依据让行动和协作都更稳定。",
      })),
    })),
    endings: [
      {
        title: "稳健完成",
        summary: "你持续核对事实并控制风险，任务得到稳健解决。",
        coachDebrief:
          "回看现场记录，找出哪些信息真正改变了你的行动，以及这些动作怎样影响了最终交付。",
      },
      {
        title: "复杂但可控",
        summary: "过程出现了取舍与波折，但你保住了主要目标。",
        coachDebrief:
          "你保住了主要结果，也留下了代价。下一次可以更早识别限制，并把补救动作纳入原始方案。",
      },
      {
        title: "需要重新调整",
        summary: "连续的高风险选择让任务受挫，但关键问题已经暴露。",
        coachDebrief: "沿着事件记录回看，找出最早出现但没有被处理的风险信号。",
      },
    ],
  };
}

const SCENARIO_THEATER_BACKGROUND_CONTEXT_PATTERNS = [
  {
    background: "briefing",
    pattern:
      /(简报|briefing|宣讲|任务说明|说明会|导入|kickoff|onboarding|集体讲解|开场布置)/u,
  },
  {
    background: "outcome",
    pattern:
      /(复盘|总结|收尾|验收|回顾|反思|结案|交付确认|debrief|wrap.?up|retrospective)/u,
  },
  {
    background: "workshop",
    pattern:
      /(厨房|烹饪|烘焙|食材|配方|模具|手作|制作|装配|组装|维修|修理|工作台|实操演示|cook|kitchen|recipe|bake|craft|assemble|repair|workbench)/u,
  },
  {
    background: "technical_lab",
    pattern:
      /(代码|软件|系统|接口|日志|部署|调试|测试环境|数据库|服务器|api|devops|engineering|technical lab)/u,
  },
  {
    background: "incident",
    pattern:
      /(故障|中断|宕机|告警|事故|应急|超时|泄漏|危机|outage|incident|alarm|emergency|failure)/u,
  },
  {
    background: "customer_lounge",
    pattern:
      /(客户|顾客|用户|服务台|接待|咨询|访谈|反馈|谈判|client|customer|consult|interview|negotiat)/u,
  },
  {
    background: "meeting_room",
    pattern:
      /(会议室|例会|站会|评审会|研讨会|头脑风暴|集体决策|sprint|standup|meeting room)/u,
  },
  {
    background: "field_site",
    pattern:
      /(户外|现场|工地|公园|社区|巡检|仓库|门店|厂房|街区|field site|onsite|outdoor|construction)/u,
  },
  {
    background: "conversation",
    pattern: /(谈话|交谈|交流|讨论|一对一|促膝|闲聊|沟通)/u,
  },
  {
    background: "workspace",
    pattern:
      /(办公桌|工位|电脑前|文档|写作|整理资料|desk work|office desk|workspace)/u,
  },
] as const satisfies ReadonlyArray<{
  background: z.infer<typeof backgroundSchema>;
  pattern: RegExp;
}>;

export function selectScenarioTheaterBackground(params: {
  theme: z.infer<typeof themeSchema>;
  act: number;
  index: number;
  context?: string;
}): z.infer<typeof backgroundSchema> {
  const context = params.context ?? "";
  for (const item of SCENARIO_THEATER_BACKGROUND_CONTEXT_PATTERNS) {
    if (!item.pattern.test(context)) continue;
    if (item.background === "incident" && params.theme === "technical") {
      return "technical_lab";
    }
    if (
      item.background === "customer_lounge" &&
      /(会议室|例会|站会|评审会|研讨会|meeting)/u.test(context)
    ) {
      return "meeting_room";
    }
    if (item.background === "customer_lounge" && params.theme === "office") {
      return "meeting_room";
    }
    return item.background;
  }
  const backgroundsByTheme = {
    office: ["meeting_room", "workspace", "incident"],
    technical: ["technical_lab", "workspace", "incident"],
    conversation: ["customer_lounge", "meeting_room", "conversation"],
    field: ["field_site", "incident", "workspace"],
    generic: ["workshop", "workspace", "conversation"],
  } as const satisfies Record<
    z.infer<typeof themeSchema>,
    readonly z.infer<typeof backgroundSchema>[]
  >;
  const candidates = backgroundsByTheme[params.theme];
  return candidates[Math.min(params.index, candidates.length - 1)]!;
}

export function resolveScenarioTheaterBackground(params: {
  preferred?: unknown;
  theme: z.infer<typeof themeSchema>;
  context?: string;
}): z.infer<typeof backgroundSchema> {
  const parsedPreferred = backgroundSchema.safeParse(params.preferred);
  if (parsedPreferred.success) return parsedPreferred.data;
  return selectScenarioTheaterBackground({
    theme: params.theme,
    act: 1,
    index: 0,
    context: params.context,
  });
}

function setupFromPlan(plan: z.infer<typeof preparedPlanSchema>) {
  return {
    title: plan.title,
    premise: plan.premise,
    learnerRole: plan.learnerRole,
    objective: plan.objective,
    theme: plan.theme,
    background: plan.background,
    characters: plan.characters,
    meterLabels: plan.meterLabels,
  } satisfies z.infer<typeof preparedSetupSchema>;
}

function coercePreparedSetup(
  candidate: unknown,
  fallback: z.infer<typeof preparedSetupSchema>,
): z.infer<typeof preparedSetupSchema> {
  const parsed = preparedSetupSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const raw =
    candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : {};
  const theme = themeSchema.safeParse(raw.theme).success
    ? themeSchema.parse(raw.theme)
    : fallback.theme;
  const premise = clampText(
    typeof raw.premise === "string" ? raw.premise : undefined,
    fallback.premise,
    500,
  );
  const objective = clampText(
    typeof raw.objective === "string" ? raw.objective : undefined,
    fallback.objective,
    300,
  );
  const title = clampText(
    typeof raw.title === "string" ? raw.title : undefined,
    fallback.title,
    80,
  );
  const learnerRole = clampText(
    typeof raw.learnerRole === "string" ? raw.learnerRole : undefined,
    fallback.learnerRole,
    120,
  );
  const characters = Array.isArray(raw.characters)
    ? raw.characters
        .flatMap((item) => {
          const parsedCharacter =
            preparedSetupSchema.shape.characters.element.safeParse(item);
          return parsedCharacter.success ? [parsedCharacter.data] : [];
        })
        .slice(0, 4)
    : [];
  const meterLabels = Array.isArray(raw.meterLabels)
    ? raw.meterLabels
        .flatMap((item) =>
          typeof item === "string" && item.trim() ? [item.trim()] : [],
        )
        .slice(0, 3)
    : [];
  const resolvedCharacters = (
    characters.length ? characters : fallback.characters
  ).slice(0, 4);
  const resolvedMeterLabels = (
    meterLabels.length ? meterLabels : fallback.meterLabels
  ).slice(0, 3);
  while (resolvedMeterLabels.length < 2) {
    resolvedMeterLabels.push(fallback.meterLabels[resolvedMeterLabels.length]!);
  }
  return preparedSetupSchema.parse({
    title,
    premise,
    learnerRole,
    objective,
    theme,
    background: resolveScenarioTheaterBackground({
      preferred: raw.background,
      theme,
      context: `${title} ${premise} ${objective}`,
    }),
    characters: resolvedCharacters,
    meterLabels: resolvedMeterLabels,
  });
}

function normalizePreparedPlan(
  value: z.infer<typeof preparedSetupSchema> | null,
  fallback: z.infer<typeof preparedPlanSchema>,
  template: TheaterTemplate,
) {
  const source = value ?? fallback;
  const characters = (
    source.characters.length ? source.characters : fallback.characters
  ).slice(0, 4);
  const meterLabels = (
    source.meterLabels.length ? source.meterLabels : fallback.meterLabels
  ).slice(0, 3);
  while (meterLabels.length < 2)
    meterLabels.push(fallback.meterLabels[meterLabels.length]!);
  const background = resolveScenarioTheaterBackground({
    preferred: source.background,
    theme: source.theme,
    context: `${source.premise} ${source.objective}`,
  });
  return {
    ...fallback,
    ...source,
    title: clampText(source.title, fallback.title, 80),
    premise: clampText(source.premise, fallback.premise, 500),
    learnerRole: clampText(source.learnerRole, fallback.learnerRole, 120),
    objective: clampText(source.objective, fallback.objective, 300),
    characters,
    meterLabels,
    background,
    scenes: template.scenes.map((templateScene, index) => {
      const candidate = fallback.scenes[index]!;
      const fallbackScene = fallback.scenes[index]!;
      return {
        ...fallbackScene,
        ...candidate,
        title: clampText(candidate.title, fallbackScene.title, 80),
        summary: clampText(candidate.summary, fallbackScene.summary, 1200),
        background,
        speakerIndex:
          Number.isInteger(candidate.speakerIndex) &&
          (candidate.speakerIndex ?? -1) >= 0 &&
          (candidate.speakerIndex ?? 0) < characters.length
            ? candidate.speakerIndex
            : 0,
        choices: templateScene.choiceRoles.map((_, choiceIndex) => {
          const choice =
            candidate.choices[choiceIndex] ??
            fallbackScene.choices[choiceIndex]!;
          const fallbackChoice = fallbackScene.choices[choiceIndex]!;
          return {
            label: clampText(choice.label, fallbackChoice.label, 180),
            consequenceBrief: clampText(
              choice.consequenceBrief,
              fallbackChoice.consequenceBrief,
              500,
            ),
            learningPoint: clampText(
              choice.learningPoint,
              fallbackChoice.learningPoint,
              500,
            ),
          };
        }),
      };
    }),
    endings: ([0, 1, 2] as const).map((index) => {
      const candidate = fallback.endings[index]!;
      const fallbackEnding = fallback.endings[index]!;
      return {
        title: clampText(candidate.title, fallbackEnding.title, 80),
        summary: clampText(candidate.summary, fallbackEnding.summary, 700),
        coachDebrief: clampText(
          candidate.coachDebrief,
          fallbackEnding.coachDebrief,
          1000,
        ),
      };
    }),
  };
}

function choiceDelta(role: TemplateScene["choiceRoles"][number]) {
  if (role === "costly") return -8;
  if (role === "recovery") return 6;
  return 8;
}

type CastGender = z.infer<typeof genderSchema>;
type CastAgeGroup = z.infer<typeof ageGroupSchema>;

const SCENARIO_CAST_ASSETS: ReadonlyArray<{
  code: string;
  gender: CastGender;
  ageGroup: CastAgeGroup;
}> = [
  { code: "young-male-a", gender: "male", ageGroup: "young_adult" },
  { code: "young-male-b", gender: "male", ageGroup: "young_adult" },
  { code: "young-female-a", gender: "female", ageGroup: "young_adult" },
  { code: "young-female-b", gender: "female", ageGroup: "young_adult" },
  { code: "middle-male-a", gender: "male", ageGroup: "middle_aged" },
  { code: "middle-male-b", gender: "male", ageGroup: "middle_aged" },
  { code: "middle-female-a", gender: "female", ageGroup: "middle_aged" },
  { code: "middle-female-b", gender: "female", ageGroup: "middle_aged" },
  { code: "older-male-a", gender: "male", ageGroup: "older_adult" },
  { code: "older-male-b", gender: "male", ageGroup: "older_adult" },
  { code: "older-female-a", gender: "female", ageGroup: "older_adult" },
  { code: "older-female-b", gender: "female", ageGroup: "older_adult" },
];

function deterministicIndex(seed: string, length: number) {
  const value = createHash("sha256").update(seed).digest().readUInt32BE(0);
  return value % length;
}

export function selectScenarioCastAsset(params: {
  name: string;
  gender: CastGender;
  ageGroup: CastAgeGroup;
  used?: ReadonlySet<string>;
}) {
  const matching = SCENARIO_CAST_ASSETS.filter(
    (asset) =>
      asset.gender === params.gender && asset.ageGroup === params.ageGroup,
  );
  const unused = matching.filter((asset) => !params.used?.has(asset.code));
  const pool = unused.length > 0 ? unused : matching;
  return pool[
    deterministicIndex(
      `${params.name}:${params.gender}:${params.ageGroup}`,
      pool.length,
    )
  ]!.code;
}

export function compilePreparedScenarioTheater(params: {
  template: TheaterTemplate;
  plan: ReturnType<typeof normalizePreparedPlan>;
}): ScenarioTheaterDefinitionV2 {
  const usedAssets = new Set<string>();
  const legacyAvatars = avatarSchema.options;
  const characters = params.plan.characters.map((character, index) => {
    const assetCode = selectScenarioCastAsset({
      name: character.name,
      gender: character.gender,
      ageGroup: character.ageGroup,
      used: usedAssets,
    });
    usedAssets.add(assetCode);
    return {
      id: `character_${index}`,
      name: clampText(character.name, `角色 ${index + 1}`, 40),
      role: clampText(character.role, "参与者", 80),
      avatar: legacyAvatars[index % legacyAvatars.length]!,
      appearance: {
        assetCode,
        gender: character.gender,
        ageGroup: character.ageGroup,
      },
    };
  });
  const meters = params.plan.meterLabels.map((label, index) => ({
    id: `meter_${index}`,
    label: clampText(label, `指标 ${index + 1}`, 20),
    initial: 50,
    min: 0,
    max: 100,
    tone: index === 0 ? ("positive" as const) : ("neutral" as const),
  }));
  return scenarioTheaterDefinitionV2Schema.parse({
    type: "scenario_theater",
    version: 2,
    title: params.plan.title,
    premise: params.plan.premise,
    learnerRole: params.plan.learnerRole,
    objective: params.plan.objective,
    theme: params.plan.theme,
    background: params.plan.background,
    characters,
    meters,
    initialSceneId: "scene_0",
    scenes: params.template.scenes.map((templateScene, sceneIndex) => {
      const authored = params.plan.scenes[sceneIndex]!;
      return {
        id: `scene_${sceneIndex}`,
        act: templateScene.act,
        title: authored.title,
        beats: [
          {
            kind: "narration",
            tone: "setup",
            text: clampText(authored.summary, "局面发生了变化。", 240),
          },
          {
            kind: "dialogue",
            speakerId: characters[authored.speakerIndex ?? 0]!.id,
            text:
              sceneIndex === 0
                ? "期限没有变，但现场条件和原计划不一样。你来定第一步。"
                : "刚才的动作已经影响到后续环节，我们得马上处理新的情况。",
          },
          {
            kind: "dialogue",
            speakerId:
              characters[
                ((authored.speakerIndex ?? 0) + 1) % characters.length
              ]!.id,
            text:
              templateScene.act === 3
                ? "只剩最后一个处理窗口，这次决定会直接影响交付。"
                : "我刚拿到一条新信息，但还不足以排除另一个风险。",
          },
          {
            kind: "narration",
            tone: "observation",
            text: "屏幕上的倒计时继续跳动，待处理事项又增加了一项。",
          },
          {
            kind: "dialogue",
            speakerId: characters[authored.speakerIndex ?? 0]!.id,
            text: "两个方案都能继续推进，但影响的人和可能造成的损失不同。",
          },
          {
            kind: "dialogue",
            speakerId:
              characters[
                ((authored.speakerIndex ?? 0) + 1) % characters.length
              ]!.id,
            text: "决定权在你。告诉我们下一步怎么做。",
          },
        ],
        background: params.plan.background,
        effect: authored.effect,
        choices: templateScene.destinations.map((destination, choiceIndex) => {
          const choice = authored.choices[choiceIndex]!;
          const delta = choiceDelta(templateScene.choiceRoles[choiceIndex]);
          return {
            id: `scene_${sceneIndex}_choice_${choiceIndex}`,
            label: choice.label,
            consequence: choice.consequenceBrief,
            reflection: choice.learningPoint,
            ...(destination.kind === "scene"
              ? { nextSceneId: `scene_${destination.index}` }
              : { endingId: `ending_${destination.index}` }),
            effects: meters.map((meter, meterIndex) => ({
              meterId: meter.id,
              delta: meterIndex === 0 ? delta : Math.trunc(delta / 2),
            })),
          };
        }),
      };
    }),
    endings: params.plan.endings.map((item, index) => ({
      id: `ending_${index}`,
      kind: index === 0 ? "strong" : index === 1 ? "mixed" : "setback",
      ...item,
    })),
  });
}

export function buildFallbackScenarioTheater(
  templateId: TheaterTemplate["id"],
  title = "测试单元",
) {
  const template = SCENARIO_THEATER_TEMPLATES[templateId];
  const fallback = fallbackPlan({ title, template });
  return compilePreparedScenarioTheater({
    template,
    plan: normalizePreparedPlan(fallback, fallback, template),
  });
}

async function contextForUnit(client: Client, unitId: string) {
  const source = await client.findContext({ unitId });
  if (!source) throw new Error("单元不存在");
  const unit = { ...source.unit, goal: { id: source.unit.goalId, title: source.unit.goalTitle } };
  const survey = source.sq3rData ? parseSurvey(source.sq3rData) : null;
  const material = await getAggregatedUnitMaterial(unitId, undefined);
  const materialText = material
    ? JSON.stringify(material)
    : source.legacyMaterial
      ? JSON.stringify({
          introduction: source.legacyMaterial.introduction,
          sections: source.legacyMaterial.sections,
          keyTakeaways: source.legacyMaterial.keyTakeaways,
        })
      : "";
  const learningTargets = survey?.learningTargets ?? [];
  return {
    unit,
    learningTargetCount: learningTargets.length,
    context: JSON.stringify({
      unitTitle: unit.title,
      goal: unit.goal.title,
      summary: unit.contentSummary,
      learningTargets,
      materialExcerpt: materialText.slice(0, 8_000),
    }),
  };
}

export async function recommendScenarioTheaterFromSurvey(
  _client: Client,
  _unitId: string,
) {
  return null;
}

export async function invalidateScenarioTheater(
  client: Client,
  unitId: string,
) {
  return client.invalidate(unitId);
}

async function enqueueOutbox(
  client: Client,
  type: string,
  payload: Record<string, unknown>,
) {
  return client.enqueue({ type, payloadJson: JSON.stringify(payload) });
}

export async function enqueueRecommendedScenarioTheater(params: {
  client: Client;
  userId: string;
  unitId: string;
}) {
  const theater = await params.client.findTheater(params.unitId);
  if (
    !theater?.recommended ||
    theater.status === "prepared" ||
    theater.status === "ready"
  ) {
    return false;
  }
  return enqueueOutbox(params.client, SCENARIO_THEATER_PREPARE_EVENT, {
    userId: params.userId,
    unitId: params.unitId,
    recommendationUpdatedAt: theater.updatedAt.toISOString(),
  });
}

export async function prepareScenarioTheater(params: {
  client: Client;
  userId: string;
  unitId: string;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: Progress;
}) {
  const { client, userId, unitId, signal, onProgress } = params;
  if (!(await client.findContext({ userId, unitId }))) throw new Error("单元不存在");
  const { unit, context, learningTargetCount } = await contextForUnit(
    client,
    unitId,
  );
  const coach = await resolveTeachingPersona(userId, unit.goalId);
  const existing = await client.findTheater(unitId);
  if (
    !params.force &&
    existing?.definitionJson &&
    (existing.status === "prepared" || existing.status === "ready")
  ) {
    return {
      theater: {
        ...scenarioTheaterDefinitionSchema.parse(existing.definitionJson),
        coach: { name: coach.name, avatarCode: coach.avatarCode },
      },
      revision: existing.revision,
      contentRevision: unit.contentRevision,
      status: existing.status,
    };
  }
  const template =
    learningTargetCount <= 2
      ? SCENARIO_THEATER_TEMPLATES.compact_5_6
      : SCENARIO_THEATER_TEMPLATES.standard_6_8;
  const fallback = fallbackPlan({ title: unit.title, template });
  const inputHash = createHash("sha256")
    .update(`${template.id}:${context}`)
    .digest("hex");
  const revision =
    existing?.definitionJson || params.force
      ? Math.max(1, (existing?.revision ?? 0) + 1)
      : (existing?.revision ?? 1);
  const preparing = await client.beginPreparation({ unitId, revision, source: existing?.source ?? "manual", recommended: existing?.recommended ?? false, recommendation: existing?.recommendation ?? "", inputHash, abandonActiveRuns: Boolean(existing?.definitionJson || params.force) });

  try {
    await onProgress?.(
      "prepare",
      tBackend("status.generation.scenarioPreparing"),
    );
    let generated: z.infer<typeof preparedSetupSchema> | null = null;
    try {
      generated = await runValidatedStructuredGeneration(
        {
          mode: "object",
          schema: preparedSetupSchema,
          prompt: "",
          options: {
            operation: "unit.scenario_theater.prepare",
            bindingSchema: preparedSetupSchema,
            meta: {
              unitId,
              goalId: unit.goalId,
              template: template.id,
              outputFormat: "structured_object",
            },
          },
          contextInvocation: {
            context,
            backgroundPrompt: formatScenarioTheaterBackgroundPrompt(),
          },
          contextSubject: {
            userId,
            goalId: unit.goalId,
            unitId,
          },
          contextQuery:
            "Prepare the optional scenario theater for this unit from its published material and active teaching persona.",
          recoveryPolicy: {
            sourceSchema: z.unknown(),
            normalize: (candidate) => {
              const value = coercePreparedSetup(
                candidate,
                setupFromPlan(fallback),
              );
              const parsed = preparedSetupSchema.safeParse(candidate);
              return {
                value,
                normalizedCount: parsed.success ? 0 : 1,
              };
            },
            repairSlots: () => [],
          },
        },
        { signal },
      );
    } catch {
      await onProgress?.(
        "fallback",
        tBackend("status.generation.scenarioFallback"),
      );
    }
    const plan = normalizePreparedPlan(generated, fallback, template);
    const definition = compilePreparedScenarioTheater({ template, plan });
    await client.publishPrepared({ theaterId: preparing.id, revision, definitionJson: definition, sceneIds: definition.scenes.map(item => item.id) });
    try {
      await enqueueOutbox(client, SCENARIO_THEATER_SCENE_PREFETCH_EVENT, {
        userId,
        unitId,
        theaterId: preparing.id,
        revision,
        sceneIds: [definition.initialSceneId],
      });
    } catch {
      // The client can still generate the current scene just in time.
    }
    const contentRevision = await client.bumpContentRevision(unitId);
    return {
      theater: {
        ...definition,
        coach: { name: coach.name, avatarCode: coach.avatarCode },
      },
      revision,
      contentRevision,
      status: "prepared",
    };
  } catch (error) {
    await client.markTheaterFailed({ theaterId: preparing.id, error: error instanceof Error ? error.message.slice(0, 2_000) : "准备失败" });
    throw error;
  }
}

export async function materializeScenarioTheaterDefinition(
  client: Client,
  theater: {
    id: string;
    revision: number;
    definitionJson: unknown;
    status?: string;
  },
) {
  const fallback = scenarioTheaterDefinitionSchema.parse(
    theater.definitionJson,
  );
  if (theater.status === "ready" || fallback.version === 1) return fallback;
  const rows = await client.listScenes({ theaterId: theater.id, revision: theater.revision });
  return materializeScenarioTheaterDefinitionFromScenes(theater, rows.filter(row => row.status === "ready"));
}

export function materializeScenarioTheaterDefinitionFromScenes(
  theater: { definitionJson: unknown; status?: string },
  rows: readonly { sceneId: string; contentJson: unknown }[],
) {
  const fallback = scenarioTheaterDefinitionSchema.parse(theater.definitionJson);
  if (theater.status === "ready" || fallback.version === 1) return fallback;
  const authored = new Map(
    rows.flatMap((row) => {
      const parsed = storedAuthoredSceneSchema.safeParse(row.contentJson);
      return parsed.success ? [[row.sceneId, parsed.data] as const] : [];
    }),
  );
  return scenarioTheaterDefinitionV2Schema.parse({
    ...fallback,
    scenes: fallback.scenes.map((item) => {
      const prose = authored.get(item.id);
      if (!prose) return item;
      return {
        ...item,
        // A prepared V2 definition has one unit-level background. Ignore any
        // legacy per-scene value written by an older scene worker.
        background: fallback.background ?? prose.background ?? item.background,
        beats: prose.beats,
        choices: item.choices.map((choice, index) => ({
          ...choice,
          label: prose.choices[index]?.label ?? choice.label,
          consequence: prose.choices[index]?.consequence ?? choice.consequence,
          reflection: prose.choices[index]?.reflection ?? choice.reflection,
        })),
      };
    }),
  });
}

async function enqueueFrontier(params: {
  client: Client;
  userId: string;
  unitId: string;
  theaterId: string;
  revision: number;
  definition: ScenarioTheaterDefinition;
  sceneIds: string[];
}) {
  const requested = new Set(params.sceneIds);
  const frontier = [
    ...new Set(
      params.definition.scenes
        .filter((item) => requested.has(item.id))
        .flatMap((item) =>
          item.choices.flatMap((choice) =>
            choice.nextSceneId ? [choice.nextSceneId] : [],
          ),
        ),
    ),
  ].slice(0, 3);
  if (frontier.length === 0) return false;
  return enqueueOutbox(params.client, SCENARIO_THEATER_SCENE_PREFETCH_EVENT, {
    userId: params.userId,
    unitId: params.unitId,
    theaterId: params.theaterId,
    revision: params.revision,
    sceneIds: frontier,
  });
}

export async function generateScenarioTheaterScenes(params: {
  client: Client;
  userId: string;
  unitId: string;
  revision: number;
  sceneIds: string[];
  signal?: AbortSignal;
  onProgress?: Progress;
}) {
  const { client, userId, unitId, revision, signal, onProgress } = params;
  const theater = await client.findTheater(unitId);
  if (
    !theater?.definitionJson ||
    theater.revision !== revision ||
    !["prepared", "ready"].includes(theater.status)
  ) {
    throw new Error("情境演练版本不可用");
  }
  const fallback = scenarioTheaterDefinitionSchema.parse(
    theater.definitionJson,
  );
  if (fallback.version === 1) return fallback;
  const requested = [...new Set(params.sceneIds)]
    .map((id) => fallback.scenes.find((item) => item.id === id))
    .filter((item): item is ScenarioTheaterDefinitionV2["scenes"][number] =>
      Boolean(item),
    )
    .slice(0, 3);
  if (requested.length === 0) return fallback;
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const claimed: typeof requested = [];
  for (const scenePlan of requested) {
    if (await client.claimScene({ theaterId: theater.id, revision, sceneId: scenePlan.id, staleBefore })) claimed.push(scenePlan);
  }
  if (claimed.length === 0) {
    return materializeScenarioTheaterDefinition(client, theater);
  }

  const { unit, context } = await contextForUnit(client, unitId);
  const coach = await resolveTeachingPersona(userId, unit.goalId);
  const narrationVoice = JSON.stringify({
    narratorName: coach.name,
    base: coach.instructions.base,
    course: coach.instructions.course ?? "",
    followUp: coach.instructions.followUp ?? "",
  });
  await onProgress?.(
    "scene",
    claimed.length === 1
      ? tBackend("status.generation.scenarioScene")
      : tBackend("status.generation.scenarioScenePrefetch"),
  );
  try {
    let usedFallback = false;
    const generated = await runValidatedStructuredGeneration(
      {
        mode: "object",
        schema: authoredSceneBatchSchema,
        prompt: "",
        options: {
          operation: "unit.scenario_theater.scene",
          bindingSchema: authoredSceneBatchSchema,
          meta: {
            unitId,
            sceneIds: claimed.map((item) => item.id),
            outputFormat: "structured_object",
          },
        },
        contextInvocation: { context, claimed, narrationVoice, fallback },
        contextSubject: {
          userId,
          goalId: unit.goalId,
          unitId,
        },
        contextQuery:
          "Author the next server-planned scenario theater scenes for this unit.",
        recoveryPolicy: {
          sourceSchema: z.unknown(),
          normalize: (candidate) => {
            const parsed = authoredSceneBatchSchema.safeParse(candidate);
            if (parsed.success) return { value: parsed.data };
            usedFallback = true;
            return {
              normalizedCount: claimed.length,
              value: {
                scenes: claimed.map((scenePlan) => ({
                  beats: scenePlan.beats.map((beat) =>
                    beat.kind === "dialogue"
                      ? {
                          kind: "dialogue" as const,
                          speakerIndex: Math.max(
                            0,
                            fallback.characters.findIndex(
                              (character) => character.id === beat.speakerId,
                            ),
                          ),
                          text: beat.text,
                          ...(beat.addressee
                            ? { addressee: beat.addressee }
                            : {}),
                        }
                      : beat,
                  ),
                  choices: scenePlan.choices.map((choice) => ({
                    label: choice.label,
                    consequence: choice.consequence,
                    reflection: choice.reflection,
                  })),
                })),
              },
            };
          },
          repairSlots: () => [],
        },
      },
      { signal },
    );
    await client.saveScenes({ theaterId: theater.id, revision, scenes: claimed.map((scenePlan, index) => {
        const prose = generated.scenes[index];
        if (!prose || prose.choices.length < scenePlan.choices.length) {
          return { sceneId: scenePlan.id, status: "fallback" as const, error: "场景文本缺失，已使用简洁版本" };
        }
        return {
            sceneId: scenePlan.id,
            status: usedFallback ? "fallback" as const : "ready" as const,
            error: usedFallback
              ? "场景文本格式不可用，已使用简洁版本"
              : "",
            contentJson: {
              id: scenePlan.id,
              background: fallback.background ?? scenePlan.background,
              beats: prose.beats.map((beat) =>
                beat.kind === "dialogue"
                  ? {
                      kind: "dialogue" as const,
                      speakerId:
                        fallback.characters[beat.speakerIndex]?.id ??
                        fallback.characters[0]!.id,
                      text: clampText(beat.text, "局面仍在变化。", 240),
                      ...(beat.addressee ? { addressee: beat.addressee } : {}),
                    }
                  : {
                      kind: "narration" as const,
                      tone: beat.tone,
                      text: clampText(beat.text, "局面仍在变化。", 240),
                    },
              ),
              choices: scenePlan.choices.map((choice, choiceIndex) => ({
                id: choice.id,
                label: clampText(
                  prose.choices[choiceIndex]?.label,
                  choice.label,
                  180,
                ),
                consequence: clampText(
                  prose.choices[choiceIndex]?.consequence,
                  choice.consequence,
                  500,
                ),
                reflection: clampText(
                  prose.choices[choiceIndex]?.reflection,
                  choice.reflection,
                  500,
                ),
              })),
            },
          };
      }) });
  } catch (error) {
    await client.failClaimedScenes({ theaterId: theater.id, revision, sceneIds: claimed.map(item => item.id), error: error instanceof Error ? error.message.slice(0, 1_000) : "生成失败" });
  }

  const claimedIds = new Set(claimed.map(item => item.id));
  const allScenes = await client.listScenes({ theaterId: theater.id, revision });
  const retryableFallbacks = allScenes.filter(item => claimedIds.has(item.sceneId) && item.status === "fallback" && item.attemptCount < 2);
  if (retryableFallbacks.length > 0) {
    await enqueueOutbox(client, SCENARIO_THEATER_SCENE_PREFETCH_EVENT, {
      userId,
      unitId,
      theaterId: theater.id,
      revision,
      sceneIds: retryableFallbacks.map((item) => item.sceneId),
      retryAttempt: Math.max(
        ...retryableFallbacks.map((item) => item.attemptCount),
      ),
    });
  }

  await enqueueFrontier({
    client,
    userId,
    unitId,
    theaterId: theater.id,
    revision,
    definition: fallback,
    sceneIds: claimed.map((item) => item.id),
  });
  const remaining = allScenes.filter(item => item.status !== "ready").length;
  if (remaining === 0) {
    await enqueueOutbox(client, SCENARIO_THEATER_FINALIZE_EVENT, {
      userId,
      unitId,
      theaterId: theater.id,
      revision,
    });
  }
  return materializeScenarioTheaterDefinition(client, theater);
}

export async function generateCurrentScenarioTheaterScene(params: {
  client: Client;
  userId: string;
  unitId: string;
  runId: string;
  signal?: AbortSignal;
  onProgress?: Progress;
}) {
  if (!(await params.client.findContext({ userId: params.userId, unitId: params.unitId }))) throw new Error("单元不存在");
  const run = await params.client.findActiveRun({ runId: params.runId, userId: params.userId, unitId: params.unitId });
  if (!run?.currentSceneId) throw new Error("当前场景不可用");
  return generateScenarioTheaterScenes({
    ...params,
    revision: run.theaterRevision,
    sceneIds: [run.currentSceneId],
  });
}

export async function finalizeScenarioTheater(params: {
  client: Client;
  userId: string;
  unitId: string;
  revision: number;
  signal?: AbortSignal;
}) {
  const theater = await params.client.findTheater(params.unitId);
  if (
    !theater?.definitionJson ||
    theater.revision !== params.revision ||
    theater.status === "ready"
  ) {
    return { status: "ignored" as const };
  }
  const remaining = (await params.client.listScenes({ theaterId: theater.id, revision: params.revision })).filter(item => item.status !== "ready").length;
  if (remaining > 0) return { status: "waiting" as const };
  let definition = await materializeScenarioTheaterDefinition(
    params.client,
    theater,
  );
  if (definition.version === 1) {
    await params.client.markReady({ theaterId: theater.id });
    return { status: "ready" as const };
  }
  const audit = await runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: auditSchema,
      prompt: "",
      options: {
        operation: "unit.scenario_theater.finalize",
        bindingSchema: auditSchema,
        meta: {
          unitId: params.unitId,
          outputFormat: "structured_object",
        },
      },
      contextInvocation: { definition },
      contextSubject: {
        userId: params.userId,
        unitId: params.unitId,
      },
      contextQuery:
        "Audit the completed scenario theater while preserving its frozen route and identifiers.",
    },
    { signal: params.signal },
  );
  const audited = applyScenarioTheaterAudit(definition, audit);
  if (!audit.approved && audited.appliedCount === 0) {
    throw new Error(
      `剧本审计未通过：${audit.issues.map((item) => item.problem).join("；")}`,
    );
  }
  definition = audited.definition;
  await params.client.markReady({ theaterId: theater.id, definitionJson: definition });
  await params.client.bumpContentRevision(params.unitId);
  return { status: "ready" as const };
}

export async function processScenarioTheaterPrepareEvent(params: {
  client: Client;
  payloadJson: string;
}) {
  const payload = JSON.parse(params.payloadJson) as {
    userId?: string;
    unitId?: string;
    recommendationUpdatedAt?: string;
  };
  if (!payload.userId || !payload.unitId) {
    throw new Error("scenario theater prepare event is missing identifiers");
  }
  const theater = await params.client.findTheater(payload.unitId);
  if (!theater?.recommended) {
    return { status: "ignored" as const, unitId: payload.unitId };
  }
  if (theater?.status === "prepared" || theater?.status === "ready") {
    return { status: "ignored" as const, unitId: payload.unitId };
  }
  if (
    payload.recommendationUpdatedAt &&
    theater.updatedAt.toISOString() !== payload.recommendationUpdatedAt &&
    theater.status !== "pending"
  ) {
    return { status: "stale" as const, unitId: payload.unitId };
  }
  await prepareScenarioTheater({
    client: params.client,
    userId: payload.userId,
    unitId: payload.unitId,
  });
  return { status: "prepared" as const, unitId: payload.unitId };
}

export async function processScenarioTheaterScenePrefetchEvent(params: {
  client: Client;
  payloadJson: string;
}) {
  const payload = JSON.parse(params.payloadJson) as {
    userId?: string;
    unitId?: string;
    revision?: number;
    sceneIds?: string[];
  };
  if (
    !payload.userId ||
    !payload.unitId ||
    !Number.isInteger(payload.revision) ||
    !Array.isArray(payload.sceneIds)
  ) {
    throw new Error("scenario theater scene event is invalid");
  }
  await generateScenarioTheaterScenes({
    client: params.client,
    userId: payload.userId,
    unitId: payload.unitId,
    revision: payload.revision!,
    sceneIds: payload.sceneIds,
  });
  return { status: "generated" as const, unitId: payload.unitId };
}

export async function processScenarioTheaterFinalizeEvent(params: {
  client: Client;
  payloadJson: string;
}) {
  const payload = JSON.parse(params.payloadJson) as {
    userId?: string;
    unitId?: string;
    revision?: number;
  };
  if (
    !payload.userId ||
    !payload.unitId ||
    !Number.isInteger(payload.revision)
  ) {
    throw new Error("scenario theater finalize event is invalid");
  }
  const result = await finalizeScenarioTheater({
    client: params.client,
    userId: payload.userId,
    unitId: payload.unitId,
    revision: payload.revision!,
  });
  return { ...result, unitId: payload.unitId };
}
