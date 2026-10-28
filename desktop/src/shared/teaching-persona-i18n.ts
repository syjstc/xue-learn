import type { TranslationKey, TranslationParams } from "@xue-learn/core/i18n";

type TeachingPersonaNameSource = {
  ref: string;
  kind: "builtin" | "custom";
  name: string;
};

type TeachingPersonaContentSource = TeachingPersonaNameSource & {
  tagline?: string;
  introduction?: string;
  traits?: string[];
};

type Translator = (key: TranslationKey, params?: TranslationParams) => string;

const BUILTIN_PERSONA_NAME_KEYS: Record<string, TranslationKey> = {
  xiaohui_female: "teachingPersona.name.xiaohuiFemale",
  xiaohui: "teachingPersona.name.xiaohui",
  zhiheng_female: "teachingPersona.name.zhihengFemale",
  zhiheng: "teachingPersona.name.zhiheng",
  lixing_female: "teachingPersona.name.lixingFemale",
  lixing: "teachingPersona.name.lixing",
  tuoye_female: "teachingPersona.name.tuoyeFemale",
  tuoye: "teachingPersona.name.tuoye",
  quzhi_female: "teachingPersona.name.quzhiFemale",
  quzhi: "teachingPersona.name.quzhi",
  ruiyan_female: "teachingPersona.name.ruiyanFemale",
  ruiyan: "teachingPersona.name.ruiyan",
  ruiyan_shadow_female: "teachingPersona.name.ruiyanShadowFemale",
  ruiyan_shadow: "teachingPersona.name.ruiyanShadow",
};

const BUILTIN_PERSONA_CONTENT_KEYS: Record<
  string,
  {
    tagline: TranslationKey;
    introduction: TranslationKey;
    traits: readonly TranslationKey[];
  }
> = {
  xiaohui: {
    tagline: "teachingPersona.xiaohui.tagline",
    introduction: "teachingPersona.xiaohui.introduction",
    traits: [
      "teachingPersona.xiaohui.trait.warm",
      "teachingPersona.xiaohui.trait.clear",
      "teachingPersona.xiaohui.trait.reliable",
    ],
  },
  zhiheng: {
    tagline: "teachingPersona.zhiheng.tagline",
    introduction: "teachingPersona.zhiheng.introduction",
    traits: [
      "teachingPersona.zhiheng.trait.rigorous",
      "teachingPersona.zhiheng.trait.precise",
      "teachingPersona.zhiheng.trait.clear",
    ],
  },
  lixing: {
    tagline: "teachingPersona.lixing.tagline",
    introduction: "teachingPersona.lixing.introduction",
    traits: [
      "teachingPersona.lixing.trait.direct",
      "teachingPersona.lixing.trait.decisive",
      "teachingPersona.lixing.trait.resultsFocused",
    ],
  },
  tuoye: {
    tagline: "teachingPersona.tuoye.tagline",
    introduction: "teachingPersona.tuoye.introduction",
    traits: [
      "teachingPersona.tuoye.trait.practical",
      "teachingPersona.tuoye.trait.open",
      "teachingPersona.tuoye.trait.peerLike",
    ],
  },
  quzhi: {
    tagline: "teachingPersona.quzhi.tagline",
    introduction: "teachingPersona.quzhi.introduction",
    traits: [
      "teachingPersona.quzhi.trait.witty",
      "teachingPersona.quzhi.trait.playful",
      "teachingPersona.quzhi.trait.notCheesy",
    ],
  },
  ruiyan: {
    tagline: "teachingPersona.ruiyan.tagline",
    introduction: "teachingPersona.ruiyan.introduction",
    traits: [
      "teachingPersona.ruiyan.trait.sharp",
      "teachingPersona.ruiyan.trait.quick",
      "teachingPersona.ruiyan.trait.softHearted",
    ],
  },
  ruiyan_shadow: {
    tagline: "teachingPersona.ruiyanShadow.tagline",
    introduction: "teachingPersona.ruiyanShadow.introduction",
    traits: [
      "teachingPersona.ruiyanShadow.trait.scheming",
      "teachingPersona.ruiyanShadow.trait.funny",
      "teachingPersona.ruiyanShadow.trait.principles",
    ],
  },
};

function builtinArchetypeCode(ref: string) {
  return ref.replace(/^builtin:/, "").replace(/_(?:female|male)$/, "");
}

export function localizeTeachingPersonaName(
  persona: TeachingPersonaNameSource | null | undefined,
  t: Translator,
): string {
  if (!persona) return t("teachingPersona.name.xiaohuiFemale");
  if (persona.kind !== "builtin") return persona.name;

  const code = persona.ref.replace(/^builtin:/, "") || persona.name;
  const key = BUILTIN_PERSONA_NAME_KEYS[code];
  return key ? t(key) : persona.name;
}

export function localizeTeachingPersonaContent(
  persona: TeachingPersonaContentSource,
  t: Translator,
) {
  if (persona.kind !== "builtin") {
    return {
      name: persona.name,
      tagline: persona.tagline ?? "",
      introduction: persona.introduction ?? "",
      traits: persona.traits ?? [],
    };
  }

  const content =
    BUILTIN_PERSONA_CONTENT_KEYS[builtinArchetypeCode(persona.ref)];
  if (!content) {
    return {
      name: localizeTeachingPersonaName(persona, t),
      tagline: persona.tagline ?? "",
      introduction: persona.introduction ?? "",
      traits: persona.traits ?? [],
    };
  }

  return {
    name: localizeTeachingPersonaName(persona, t),
    tagline: t(content.tagline),
    introduction: t(content.introduction),
    traits: content.traits.map((key) => t(key)),
  };
}
