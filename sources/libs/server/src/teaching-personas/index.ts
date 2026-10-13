import { getRuntimeEnvironment } from "../env.js";
import type {
  LearningGoalRepository,
  TeachingPersonaRepository,
  UserSettingsRepository,
} from "../../../domain/src/index.js";
import { GODOT_RUIYU_CODE, godotRuiyuPersona } from "./godot-ruiyu.js";
import {
  hostedPublicTeachingPersonaRef,
  isDesktopOnlyBuiltinTeachingPersona,
} from "../../../domain/src/index.js";
import {
  formatTeachingPersonaPromptBlock,
  formatTeachingPersonaPromptPart,
  type TeachingPersonaPromptPart,
} from "./prompt.js";
import {
  defaultTeachingPersonaInstructions,
  parseTeachingPersonaInstructions,
  type PersonaPromptLocale,
  type TeachingPersonaInstructions,
} from "./instructions.js";

export {
  formatTeachingPersonaPromptBlock,
  formatTeachingPersonaPromptPart,
  TEACHING_PERSONA_PROMPT_PARTS,
} from "./prompt.js";
export type {
  TeachingPersonaPromptPart,
  TeachingPersonaPromptSource,
} from "./prompt.js";
export {
  defaultTeachingPersonaInstructions,
  parseTeachingPersonaInstructions,
  PERSONA_PROMPT_LOCALES,
  resolvePersonaPromptLocale,
  teachingPersonaInstructionsSchema,
  TEACHING_PERSONA_BASE_INSTRUCTION_MAX_LENGTH,
  TEACHING_PERSONA_INSTRUCTION_VERSION,
  TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH,
} from "./instructions.js";
export type {
  PersonaPromptLocale,
  TeachingPersonaInstructions,
} from "./instructions.js";
export {
  previewTeachingPersona,
  TEACHING_PERSONA_PREVIEW_SCENES,
} from "./preview.js";
export type {
  TeachingPersonaPreviewSample,
  TeachingPersonaPreviewScene,
} from "./preview.js";

let configuredPersistence:
  | Readonly<{
      goals: LearningGoalRepository;
      personas: TeachingPersonaRepository;
      settings: UserSettingsRepository;
    }>
  | undefined;

export function configureTeachingPersonaResolutionPersistence(
  persistence:
    | Readonly<{
        goals: LearningGoalRepository;
        personas: TeachingPersonaRepository;
        settings: UserSettingsRepository;
      }>
    | undefined,
): void {
  configuredPersistence = persistence;
}

function persistence() {
  if (!configuredPersistence) {
    throw new Error(
      "Teaching-persona resolution persistence is not configured",
    );
  }
  return configuredPersistence;
}

export const DEFAULT_TEACHING_PERSONA_REF = "builtin:xiaohui_female";
export const TEACHING_PERSONA_ARCHETYPE_CODES = [
  "xiaohui",
  "zhiheng",
  "lixing",
  "tuoye",
  "quzhi",
  "ruiyan",
  "ruiyan_shadow",
] as const;

export const BUILTIN_TEACHING_PERSONA_CODES = [
  "xiaohui_female",
  "xiaohui",
  "zhiheng_female",
  "zhiheng",
  "lixing_female",
  "lixing",
  "tuoye_female",
  "tuoye",
  "quzhi_female",
  "quzhi",
  "ruiyan_female",
  "ruiyan",
  "ruiyan_shadow_female",
  "ruiyan_shadow",
] as const;

export type TeachingPersonaArchetypeCode =
  (typeof TEACHING_PERSONA_ARCHETYPE_CODES)[number];
export type BuiltinTeachingPersonaCode =
  (typeof BUILTIN_TEACHING_PERSONA_CODES)[number];

export type TeachingPersona = {
  ref: string;
  kind: "builtin" | "custom";
  code: string;
  /** Catalog grouping only. Custom personas have no inherited archetype. */
  archetypeCode: TeachingPersonaArchetypeCode | null;
  gender: "male" | "female";
  name: string;
  avatarCode: string;
  tagline: string;
  introduction: string;
  traits: string[];
  bestFor: string[];
  learnerAddress: string;
  instructions: TeachingPersonaInstructions;
  editable: boolean;
};

type BuiltinMetadata = Omit<
  TeachingPersona,
  | "ref"
  | "kind"
  | "code"
  | "avatarCode"
  | "archetypeCode"
  | "gender"
  | "instructions"
  | "editable"
>;

const BUILTIN_METADATA: Record<TeachingPersonaArchetypeCode, BuiltinMetadata> =
  {
    xiaohui: {
      name: "小会",
      tagline: "温柔可靠的学习伙伴",
      introduction:
        "我会陪你把复杂的事情慢慢讲清，再找到眼前最容易迈出的一步。",
      traits: ["温柔", "可靠", "清晰"],
      bestFor: ["通用学习", "系统自学", "克服畏难"],
      learnerAddress: "你",
    },
    zhiheng: {
      name: "知衡",
      tagline: "严谨思辨教授",
      introduction:
        "我会先钉牢定义、前提与边界，再用必要的追问检验推理，最后把结论简明讲清。",
      traits: ["严谨", "简练", "思路清晰"],
      bestFor: ["专业理论", "技术原理", "概念与推理训练"],
      learnerAddress: "你",
    },
    lixing: {
      name: "砺行",
      tagline: "高效冲刺教练",
      introduction: "目标、差距、行动——先拿下最高价值的部分。",
      traits: ["直接", "果断", "结果导向"],
      bestFor: ["复习备考", "面试冲刺"],
      learnerAddress: "你",
    },
    tuoye: {
      name: "拓野",
      tagline: "项目实战前辈",
      introduction: "先做出一个能跑的小版本，再从结果倒推原理。",
      traits: ["务实", "开放", "同行感"],
      bestFor: ["编程", "职业技能", "创作"],
      learnerAddress: "你",
    },
    quzhi: {
      name: "趣知",
      tagline: "懒洋洋耍帅的梗王学伴",
      introduction:
        "我一般懒得把知识讲得这么好笑——但既然来了，就随手整点梗、耍个帅，再把重点轻轻松松焊进你脑子里。",
      traits: ["会整活", "油滑", "松弛耍帅"],
      bestFor: ["容易走神", "喜欢玩梗", "想把概念记牢"],
      learnerAddress: "你",
    },
    ruiyan: {
      name: "锐言",
      tagline: "傲娇毒舌的锐评教练",
      introduction:
        "能让我亲自教算你走运；知识我会讲明白，你糊弄、嘴硬或逻辑出走时，也别怪我站在高处锐评两句。",
      traits: ["傲娇", "毒舌", "高段位"],
      bestFor: ["需要提神", "容易自我糊弄", "喜欢损友式督促"],
      learnerAddress: "你",
    },
    ruiyan_shadow: {
      name: "锐言·腹黑",
      tagline: "第一性原理，嘲讽拉满",
      introduction:
        "从建目标开始就按第一性原理排课：不跟教材目录走，嘲讽开到最大。事实必须对，话必须让人秒懂。",
      traits: ["腹黑", "嘲讽拉满", "第一性原理"],
      bestFor: ["桌面自学", "要秒懂不要课本目录", "吃得了损"],
      learnerAddress: "你",
    },
  };

const BUILTIN_VARIANTS: Record<
  BuiltinTeachingPersonaCode,
  {
    archetypeCode: TeachingPersonaArchetypeCode;
    gender: "male" | "female";
    name: string;
  }
> = {
  xiaohui: { archetypeCode: "xiaohui", gender: "male", name: "小会" },
  xiaohui_female: { archetypeCode: "xiaohui", gender: "female", name: "小慧" },
  zhiheng: { archetypeCode: "zhiheng", gender: "male", name: "知衡" },
  zhiheng_female: { archetypeCode: "zhiheng", gender: "female", name: "知微" },
  lixing: { archetypeCode: "lixing", gender: "male", name: "砺行" },
  lixing_female: { archetypeCode: "lixing", gender: "female", name: "砺然" },
  tuoye: { archetypeCode: "tuoye", gender: "male", name: "拓野" },
  tuoye_female: { archetypeCode: "tuoye", gender: "female", name: "拓岚" },
  quzhi: { archetypeCode: "quzhi", gender: "male", name: "趣知" },
  quzhi_female: { archetypeCode: "quzhi", gender: "female", name: "妙知" },
  ruiyan: { archetypeCode: "ruiyan", gender: "male", name: "锐言" },
  ruiyan_female: { archetypeCode: "ruiyan", gender: "female", name: "锐语" },
  ruiyan_shadow: {
    archetypeCode: "ruiyan_shadow",
    gender: "male",
    name: "锐言·腹黑",
  },
  ruiyan_shadow_female: {
    archetypeCode: "ruiyan_shadow",
    gender: "female",
    name: "锐语·腹黑",
  },
};

function buildBuiltinTeachingPersona(
  code: BuiltinTeachingPersonaCode,
  locale: PersonaPromptLocale = "zh-Hans",
): TeachingPersona {
  const variant = BUILTIN_VARIANTS[code];
  const metadata = BUILTIN_METADATA[variant.archetypeCode];
  return {
    ...metadata,
    ...variant,
    code,
    avatarCode: code,
    ref: `builtin:${code}`,
    kind: "builtin",
    editable: false,
    instructions: defaultTeachingPersonaInstructions(
      variant.archetypeCode,
      metadata,
      locale,
    ),
  };
}

export function listBuiltinTeachingPersonas(
  locale: PersonaPromptLocale = "zh-Hans",
  options?: { includeDesktopOnly?: boolean },
): TeachingPersona[] {
  return BUILTIN_TEACHING_PERSONA_CODES.filter(
    (code) =>
      options?.includeDesktopOnly === true ||
      !isDesktopOnlyBuiltinTeachingPersona(code),
  ).map((code) => buildBuiltinTeachingPersona(code, locale));
}

export function getBuiltinTeachingPersona(
  refOrCode: string,
  locale: PersonaPromptLocale = "zh-Hans",
): TeachingPersona | null {
  const code = refOrCode.replace(/^builtin:/, "") as BuiltinTeachingPersonaCode;
  if (getRuntimeEnvironment().XUELEARN_CLIENT_KIND === "godot" && refOrCode.replace(/^builtin:/, "") === GODOT_RUIYU_CODE) {
    return godotRuiyuPersona(locale);
  }
  return BUILTIN_VARIANTS[code]
    ? buildBuiltinTeachingPersona(code, locale)
    : null;
}

function genderForAvatar(avatarCode: string): "male" | "female" {
  const variant = BUILTIN_VARIANTS[avatarCode as BuiltinTeachingPersonaCode];
  return (
    variant?.gender ?? (avatarCode.endsWith("_female") ? "female" : "male")
  );
}

export function customRecordToPersona(row: {
  id: string;
  name: string;
  avatarCode: string;
  tagline: string;
  learnerAddress: string;
  instructionsJson?: string | null;
}): TeachingPersona {
  const instructions = parseTeachingPersonaInstructions(row.instructionsJson);
  const fallback = defaultTeachingPersonaInstructions("custom", {
    introduction: row.tagline || `我是${row.name}。`,
    traits: [],
  });
  return {
    ref: `custom:${row.id}`,
    kind: "custom",
    code: row.id,
    archetypeCode: null,
    editable: true,
    name: row.name,
    avatarCode: row.avatarCode,
    gender: genderForAvatar(row.avatarCode),
    tagline: row.tagline,
    introduction: `我是${row.name}。${row.tagline}`,
    traits: [],
    bestFor: [],
    learnerAddress: row.learnerAddress,
    instructions: instructions ?? fallback,
  };
}

export function teachingPersonaForResponse(
  persona: TeachingPersona,
  locale: PersonaPromptLocale = "zh-Hans",
): TeachingPersona {
  return persona.kind === "builtin"
    ? getBuiltinTeachingPersona(persona.ref, locale)!
    : persona;
}

export async function resolveTeachingPersona(
  userId: string,
  goalId?: string,
  locale: PersonaPromptLocale = "zh-Hans",
): Promise<TeachingPersona> {
  if (getRuntimeEnvironment().XUELEARN_CLIENT_KIND === "godot") return godotRuiyuPersona(locale);
  const repositories = persistence();
  const [settings, goal] = await Promise.all([
    repositories.settings.findByUserId(userId),
    goalId ? repositories.goals.findOwnedById(userId, goalId) : null,
  ]);
  const rawRef =
    goal?.teachingPersonaRef ||
    settings?.teachingPersonaRef ||
    DEFAULT_TEACHING_PERSONA_REF;
  const ref =
    getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1"
      ? rawRef
      : hostedPublicTeachingPersonaRef(rawRef);
  const builtin = getBuiltinTeachingPersona(ref, locale);
  if (builtin) return builtin;
  if (ref.startsWith("custom:")) {
    const row = (await repositories.personas.listByUserId(userId)).find(
      (candidate) => candidate.id === ref.slice(7),
    );
    if (row) return customRecordToPersona(row);
  }
  return getBuiltinTeachingPersona(DEFAULT_TEACHING_PERSONA_REF, locale)!;
}

export async function formatTeachingPersonaPromptPartForUser(
  userId: string,
  goalId: string | undefined,
  part: TeachingPersonaPromptPart,
  locale: PersonaPromptLocale = "zh-Hans",
) {
  return formatTeachingPersonaPromptPart(
    await resolveTeachingPersona(userId, goalId, locale),
    part,
  );
}

export async function formatTeachingPersonaPromptBlockForUser(
  userId: string,
  goalId?: string,
  locale: PersonaPromptLocale = "zh-Hans",
) {
  return formatTeachingPersonaPromptBlock(
    await resolveTeachingPersona(userId, goalId, locale),
  );
}
