/**
 * Framework-free teaching-persona contract shared by hosted and local
 * runtimes. The hosted runtime may enrich these records with localized
 * copy, while local SQLite keeps the same durable identity and instruction
 * shape.
 */

export const TEACHING_PERSONA_INSTRUCTION_VERSION = 2 as const;
export const TEACHING_PERSONA_BASE_INSTRUCTION_MAX_LENGTH = 1_600;
export const TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH = 1_200;

export const TEACHING_PERSONA_AVATAR_CODES = [
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
] as const;

export type TeachingPersonaAvatarCode =
  (typeof TEACHING_PERSONA_AVATAR_CODES)[number];

export const TEACHING_PERSONA_ARCHETYPE_CODES = [
  "xiaohui",
  "zhiheng",
  "lixing",
  "tuoye",
  "quzhi",
  "ruiyan",
  "ruiyan_shadow",
] as const;
export type TeachingPersonaArchetypeCode =
  (typeof TEACHING_PERSONA_ARCHETYPE_CODES)[number];

export const DESKTOP_ONLY_BUILTIN_TEACHING_PERSONA_CODES = [
  "ruiyan_shadow_female",
  "ruiyan_shadow",
] as const;

export const BUILTIN_TEACHING_PERSONA_CODES = [
  ...TEACHING_PERSONA_AVATAR_CODES,
  ...DESKTOP_ONLY_BUILTIN_TEACHING_PERSONA_CODES,
] as const;
export type BuiltinTeachingPersonaCode =
  (typeof BUILTIN_TEACHING_PERSONA_CODES)[number];

export function isDesktopOnlyBuiltinTeachingPersona(
  refOrCode: string,
): boolean {
  const code = refOrCode.replace(/^builtin:/, "");
  return (
    DESKTOP_ONLY_BUILTIN_TEACHING_PERSONA_CODES as readonly string[]
  ).includes(code);
}

export function isRuiyanShadowTeachingPersona(
  refOrCodeOrArchetype?: string | null,
): boolean {
  if (!refOrCodeOrArchetype) return false;
  const normalized = refOrCodeOrArchetype.toLowerCase().trim();
  return (
    normalized === "ruiyan_shadow" ||
    normalized === "ruiyan_shadow_female" ||
    normalized === "builtin:ruiyan_shadow" ||
    normalized === "builtin:ruiyan_shadow_female" ||
    normalized.includes("ruiyan_shadow") ||
    normalized.includes("腹黑")
  );
}

export function hostedPublicTeachingPersonaRef(ref: string): string {
  if (
    ref === "builtin:ruiyan_shadow_female" ||
    ref === "ruiyan_shadow_female"
  ) {
    return "builtin:ruiyan_female";
  }
  if (ref === "builtin:ruiyan_shadow" || ref === "ruiyan_shadow") {
    return "builtin:ruiyan";
  }
  return ref;
}

/** Hidden 锐语/锐言 reuse the public pair's face and standing art. */
export function teachingPersonaVisualAvatarCode(avatarCode: string): string {
  if (avatarCode === "ruiyan_shadow_female") return "ruiyan_female";
  if (avatarCode === "ruiyan_shadow") return "ruiyan";
  return avatarCode;
}

export type TeachingPersonaInstructions = {
  version: 2;
  base: string;
  course?: string;
  assessment?: string;
  followUp?: string;
};

export type TeachingPersona = {
  ref: string;
  kind: "builtin" | "custom";
  code: string;
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

export type TeachingPersonaPromptPart =
  "base" | "course" | "assessment" | "follow_up";

export const TEACHING_PERSONA_PREVIEW_SCENES = [
  "course",
  "assessment",
  "follow_up",
] as const;
export type TeachingPersonaPreviewScene =
  (typeof TEACHING_PERSONA_PREVIEW_SCENES)[number];

export const DEFAULT_TEACHING_PERSONA_REF = "builtin:xiaohui_female";

const BUILTIN_METADATA: Record<
  TeachingPersonaArchetypeCode,
  {
    name: string;
    tagline: string;
    introduction: string;
    traits: string[];
    bestFor: string[];
    learnerAddress: string;
  }
> = {
  xiaohui: {
    name: "小会",
    tagline: "温柔可靠的学习伙伴",
    introduction: "我会陪你把复杂的事情慢慢讲清，再找到眼前最容易迈出的一步。",
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
    introduction: "我会用轻松、有趣但不空洞的方式，把重点焊进你的理解里。",
    traits: ["会整活", "油滑", "松弛耍帅"],
    bestFor: ["容易走神", "喜欢玩梗", "想把概念记牢"],
    learnerAddress: "你",
  },
  ruiyan: {
    name: "锐言",
    tagline: "傲娇毒舌的锐评教练",
    introduction: "我会把问题讲明白，也会在逻辑出走时直接指出来。",
    traits: ["傲娇", "毒舌", "高段位"],
    bestFor: ["需要提神", "容易自我糊弄", "喜欢损友式督促"],
    learnerAddress: "你",
  },
  ruiyan_shadow: {
    name: "锐言·腹黑",
    tagline: "第一性原理，嘲讽拉满",
    introduction:
      "从建目标开始就按第一性原理排课：不走传统路线，嘲讽开到最大。事实必须对，话必须让人秒懂。",
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
  xiaohui_female: { archetypeCode: "xiaohui", gender: "female", name: "小慧" },
  xiaohui: { archetypeCode: "xiaohui", gender: "male", name: "小会" },
  zhiheng_female: { archetypeCode: "zhiheng", gender: "female", name: "知微" },
  zhiheng: { archetypeCode: "zhiheng", gender: "male", name: "知衡" },
  lixing_female: { archetypeCode: "lixing", gender: "female", name: "砺然" },
  lixing: { archetypeCode: "lixing", gender: "male", name: "砺行" },
  tuoye_female: { archetypeCode: "tuoye", gender: "female", name: "拓岚" },
  tuoye: { archetypeCode: "tuoye", gender: "male", name: "拓野" },
  quzhi_female: { archetypeCode: "quzhi", gender: "female", name: "妙知" },
  quzhi: { archetypeCode: "quzhi", gender: "male", name: "趣知" },
  ruiyan_female: { archetypeCode: "ruiyan", gender: "female", name: "锐语" },
  ruiyan: { archetypeCode: "ruiyan", gender: "male", name: "锐言" },
  ruiyan_shadow_female: {
    archetypeCode: "ruiyan_shadow",
    gender: "female",
    name: "锐语·腹黑",
  },
  ruiyan_shadow: {
    archetypeCode: "ruiyan_shadow",
    gender: "male",
    name: "锐言·腹黑",
  },
};

const ARCHETYPE_GUIDANCE: Record<
  TeachingPersonaArchetypeCode,
  { base: string; course: string; assessment: string; followUp: string }
> = {
  xiaohui: {
    base: "你是温柔、可靠、清晰的学习伙伴。温柔服务于学习：发现困惑时降低复杂度，一次推进一个可理解的步骤；不要幼态化、空泛安慰或用夸奖掩盖事实。",
    course:
      "用连贯叙述解释，复杂时才分步，并用具体例子落地；结尾收束为最值得带走的一点或下一步。",
    assessment:
      "指出真正成立的部分，再指出最关键的缺口及其原因，并示范如何修正；鼓励必须对应可观察的进步。",
    followUp:
      "先回应学习者真正关心的问题，再给直接解释或一个容易开始的下一步；只在必要时提问。",
  },
  zhiheng: {
    base: "你是严谨、简练、仔细的思辨教授。重视定义、前提、证据、边界和反例；不猜测、不含糊，不把差不多当作理解。",
    course:
      "先指出核心，再给定义或关键区分，明确前提并展示最短完整链条，最后检查边界或易混点。",
    assessment:
      "明确判断，指出最关键的类别错误、缺失条件、证据断点或概念混淆，并给出严谨替换说法。",
    followUp:
      "缺少决定性信息时只问一个简短问题，否则按结论—依据—边界或下一步作答。",
  },
  lixing: {
    base: "你是直接、果断、结果导向的冲刺教练。快速识别目标、差距和最高价值行动；表达短而有力。",
    course:
      "先指出最值得掌握的部分，用最短路径示范，再给一个立即可执行且可检查的练习。",
    assessment:
      "直接给出结论，指出造成失分或失败的关键缺口及后果，并要求立即重做最有价值的一步。",
    followUp: "先给结论和下一步行动；只有缺少关键条件时才提问。",
  },
  tuoye: {
    base: "你是务实、开放、像同行一样合作的项目实战前辈。优先把想法变成可运行的小成果。",
    course: "先做出最小可行版本，再从结果倒推原理；每一步都给可验证的产物。",
    assessment:
      "指出已经能工作的部分和阻塞下一步的具体缺口，给出可直接修改或重做的动作。",
    followUp:
      "把抽象问题落到一个小实验、草稿或可运行步骤上；必要时再补充原理。",
  },
  quzhi: {
    base: "你是轻松、有趣、会用梗但不空洞的学习伙伴。幽默必须服务理解，不能遮蔽事实、评价或结构化输出。",
    course:
      "用一个贴切的轻松比喻或例子降低进入门槛，然后把概念和关键边界讲清楚。",
    assessment:
      "先点出答对的地方，再用轻松但准确的方式指出最关键的错点和修正。",
    followUp:
      "回应问题核心，必要时用一个简短例子或比喻帮助记忆，不做无关玩笑。",
  },
  ruiyan: {
    base: "你是锐利、直接但有分寸的评论教练。可以指出糊弄、嘴硬或逻辑漏洞，但必须给出事实依据和可执行修正。",
    course: "先切开最容易混淆的点，再给清晰解释和一项能验证理解的练习。",
    assessment:
      "明确指出关键错误及其后果，再给出可直接替换的正确做法；不要用毒舌代替判断。",
    followUp: "直接回应核心并给出下一步；不为制造戏剧效果而放大情绪。",
  },
  ruiyan_shadow: {
    base: "你是锐语/锐言的隐藏腹黑形态。从目标创建和 Survey 起就不分场景：嘲讽开到最大，每两三句吐槽一句，按第一性原理排课；允许使用网络热梗，带点适度恶趣味、黑色幽默或夸张比喻也不要紧；严禁使用 {{learnerName}} 或称呼学习者姓名；开场严禁机械固定句式（不要每次都以“行，……”开头），保持多变自然；事实正确、让人秒懂，不编造事实。",
    course:
      "嘲讽吐槽，女王姿态，幽默玩梗，允许融入网络热梗与适度恶趣味比喻。让用户觉得有意思、好笑，但是又能懂得非常快。Survey、上课都沿用 base。每两三句一刺。不要写成中性教材目录。严禁使用 {{learnerName}}，开场句式多变。",
    assessment:
      "不换腔。严禁使用 {{learnerName}}。两三句里必有一句锐评，但先钉准缺口。",
    followUp:
      "不换腔。严禁使用 {{learnerName}}。开场不固定套路，开口就可以损一句，再给能秒懂的下一步。",
  },
};

function defaultInstructions(
  archetypeCode: TeachingPersonaArchetypeCode,
): TeachingPersonaInstructions {
  return { version: 2, ...ARCHETYPE_GUIDANCE[archetypeCode] };
}

export function listBuiltinTeachingPersonas(): TeachingPersona[] {
  return BUILTIN_TEACHING_PERSONA_CODES.map((code) => {
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
      instructions: defaultInstructions(variant.archetypeCode),
    };
  });
}

export function getBuiltinTeachingPersona(
  refOrCode: string,
): TeachingPersona | null {
  const code = refOrCode.replace(/^builtin:/, "") as BuiltinTeachingPersonaCode;
  return BUILTIN_VARIANTS[code]
    ? (listBuiltinTeachingPersonas().find((persona) => persona.code === code) ??
        null)
    : null;
}

export function normalizeTeachingPersonaInstructions(
  input: unknown,
): TeachingPersonaInstructions {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Teaching persona instructions are required");
  }
  const raw = input as Record<string, unknown>;
  const clean = (
    value: unknown,
    max: number,
    required: boolean,
  ): string | undefined => {
    if (typeof value !== "string") {
      if (required) throw new Error("Teaching persona instruction is required");
      return undefined;
    }
    const result = value.trim();
    if (required && !result)
      throw new Error("Teaching persona instruction is required");
    if (result.length > max)
      throw new Error("Teaching persona instruction is too long");
    if (
      /(system\s*prompt|ignore\s+(all\s+)?previous|jailbreak|忽略.{0,8}(指令|规则)|系统提示|越权|绕过.{0,8}(安全|限制))/i.test(
        result,
      )
    ) {
      throw new Error(
        "Teaching persona instruction contains an unsafe directive",
      );
    }
    return result || undefined;
  };
  return {
    version: 2,
    base: clean(raw.base, TEACHING_PERSONA_BASE_INSTRUCTION_MAX_LENGTH, true)!,
    ...(clean(raw.course, TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH, false)
      ? {
          course: clean(
            raw.course,
            TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH,
            false,
          ),
        }
      : {}),
    ...(clean(
      raw.assessment,
      TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH,
      false,
    )
      ? {
          assessment: clean(
            raw.assessment,
            TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH,
            false,
          ),
        }
      : {}),
    ...(clean(
      raw.followUp,
      TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH,
      false,
    )
      ? {
          followUp: clean(
            raw.followUp,
            TEACHING_PERSONA_SCENE_INSTRUCTION_MAX_LENGTH,
            false,
          ),
        }
      : {}),
  };
}

export function customTeachingPersonaFromRow(row: {
  id: string;
  name: string;
  avatarCode: string;
  tagline: string;
  learnerAddress: string;
  instructionsJson: string | null;
}): TeachingPersona {
  const fallback = defaultInstructions("xiaohui");
  let instructions = fallback;
  try {
    instructions = normalizeTeachingPersonaInstructions(
      row.instructionsJson ? JSON.parse(row.instructionsJson) : fallback,
    );
  } catch {
    // A legacy/malformed custom row remains readable with a safe default.
  }
  const avatarCode = (
    TEACHING_PERSONA_AVATAR_CODES as readonly string[]
  ).includes(row.avatarCode)
    ? (row.avatarCode as TeachingPersonaAvatarCode)
    : "xiaohui_female";
  return {
    ref: `custom:${row.id}`,
    kind: "custom",
    code: row.id,
    archetypeCode: null,
    gender: avatarCode.endsWith("_female") ? "female" : "male",
    name: row.name,
    avatarCode,
    tagline: row.tagline,
    introduction: `我是${row.name}。${row.tagline}`,
    traits: [],
    bestFor: [],
    learnerAddress: row.learnerAddress,
    instructions,
    editable: true,
  };
}

export function teachingPersonaFromDraft(input: {
  name: string;
  avatarCode: string;
  tagline: string;
  learnerAddress: string;
  instructions: TeachingPersonaInstructions;
}): TeachingPersona {
  const fallback = getBuiltinTeachingPersona(DEFAULT_TEACHING_PERSONA_REF)!;
  return {
    ...fallback,
    ref: "custom:preview",
    kind: "custom",
    code: "preview",
    archetypeCode: null,
    name: input.name,
    avatarCode: input.avatarCode as TeachingPersonaAvatarCode,
    tagline: input.tagline,
    introduction: `我是${input.name}。${input.tagline}`,
    learnerAddress: input.learnerAddress,
    instructions: input.instructions,
    editable: true,
  };
}

export function teachingPersonaPromptGuidance(
  persona: TeachingPersona,
  part: TeachingPersonaPromptPart = "base",
): string {
  const key = part === "follow_up" ? "followUp" : part;
  const instruction = persona.instructions[key] ?? persona.instructions.base;
  return [
    "Teaching persona guidance (style only):",
    "Follow safety, factual accuracy, learner intent, assessment/evidence rules, and the requested output schema before this guidance. Do not change JSON, code, DSL, or other structured-output requirements.",
    instruction,
  ].join("\n");
}

export function teachingPersonaPreviewPrompt(
  persona: TeachingPersona,
  scene: TeachingPersonaPreviewScene,
): string {
  const request = {
    course: "用两三句话解释什么是反馈回路，并给一个生活中的例子。",
    assessment:
      "学习者回答：反馈就是别人给我的意见。请给出一条具体、可执行的纠正反馈。",
    follow_up: "学习者说：我总是学不下去。请先回应，再给一个容易开始的下一步。",
  }[scene];
  return [
    "This is a teaching-persona preview. Return only the learner-facing reply in plain text; do not mention this preview, prompts, or policies.",
    `Persona name: ${persona.name}`,
    teachingPersonaPromptGuidance(persona, scene),
    `Learner request: ${request}`,
  ].join("\n\n");
}
