import type { ContentLanguageCode } from "../llm/content-language.js";

/** MiniMax voice_setting.vol — API range (0, 10], default 1. */
export const MINIMAX_TTS_VOLUME = 3;

/** Narration “role” presets — voice_id per language. */
export const MINIMAX_TTS_VOICE_PRESETS = [
  {
    code: "college_student",
    label: "大学生",
    description: "自然清晰的青年男声，适合通用讲解",
    narrationStyle: "auto",
    speed: 1,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
  {
    code: "young_girl",
    label: "少女",
    description: "年轻女声，清晰自然",
    narrationStyle: "auto",
    speed: 1,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
  {
    code: "clever_boy",
    label: "聪明男童",
    description: "机灵男童，适合轻松活泼的内容",
    narrationStyle: "happy",
    speed: 1.02,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
  {
    code: "lovely_girl",
    label: "甜美女声",
    description: "亲切活泼的年轻女声",
    narrationStyle: "happy",
    speed: 1,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
  {
    code: "cute_spirit",
    label: "憨憨萌兽",
    description: "萌系角色音，适合趣味内容",
    narrationStyle: "happy",
    speed: 1.03,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 1,
  },
  {
    code: "funny_elder",
    label: "搞笑大爷",
    description: "幽默风趣的长辈声线",
    narrationStyle: "fluent",
    speed: 0.98,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
  {
    code: "pro_female_host",
    label: "专业女主持",
    description: "标准、权威的女主持感",
    narrationStyle: "calm",
    speed: 0.98,
    vol: MINIMAX_TTS_VOLUME,
    pitch: -1,
  },
  {
    code: "warm_girl",
    label: "温暖少女",
    description: "温柔亲切的女声，适合陪伴式讲解",
    narrationStyle: "auto",
    speed: 1,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
  {
    code: "radio_male_host",
    label: "电台男主播",
    description: "沉稳磁性的男声，适合播客与旁白",
    narrationStyle: "calm",
    speed: 0.98,
    vol: MINIMAX_TTS_VOLUME,
    pitch: 0,
  },
] as const;

export const MINIMAX_TTS_LANGUAGE_OPTIONS = [
  { code: "auto", label: "自动识别" },
  { code: "Chinese", label: "中文普通话" },
  { code: "Chinese,Yue", label: "粤语" },
  { code: "English", label: "English" },
  { code: "Japanese", label: "日本語" },
  { code: "Korean", label: "한국어" },
  { code: "Spanish", label: "Español" },
  { code: "French", label: "Français" },
  { code: "German", label: "Deutsch" },
  { code: "Portuguese", label: "Português" },
  { code: "Italian", label: "Italiano" },
  { code: "Russian", label: "Русский" },
  { code: "Arabic", label: "العربية" },
  { code: "Hindi", label: "हिन्दी" },
  { code: "Vietnamese", label: "Tiếng Việt" },
  { code: "Indonesian", label: "Bahasa Indonesia" },
  { code: "Thai", label: "ไทย" },
  { code: "Turkish", label: "Türkçe" },
  { code: "Dutch", label: "Nederlands" },
  { code: "Polish", label: "Polski" },
  { code: "Ukrainian", label: "Українська" },
  { code: "Romanian", label: "Română" },
  { code: "Greek", label: "Ελληνικά" },
  { code: "Czech", label: "Čeština" },
  { code: "Finnish", label: "Suomi" },
] as const;

export type MinimaxTtsVoicePresetCode =
  (typeof MINIMAX_TTS_VOICE_PRESETS)[number]["code"];

export type MinimaxTtsNarrationStyleCode =
  (typeof MINIMAX_TTS_VOICE_PRESETS)[number]["narrationStyle"] | "serious";

export type MinimaxTtsLanguageBoost =
  (typeof MINIMAX_TTS_LANGUAGE_OPTIONS)[number]["code"];

export type MinimaxTtsVoicePreset =
  (typeof MINIMAX_TTS_VOICE_PRESETS)[number] & {
    voiceId: string;
  };

export type MinimaxTtsNarrationStyle = {
  code: MinimaxTtsNarrationStyleCode;
  emotion?: string;
  speedOffset: number;
  pitchOffset: number;
};

export type MinimaxTtsRequestOptions = {
  voicePreset?: string;
  /** Exact MiniMax system/cloned voice_id. Overrides the preset's language mapping. */
  voiceId?: string;
  languageBoost?: string;
  narrationStyle?: string;
  /** TTS model override (defaults to speech-2.8-turbo). */
  model?: string;
  /** Dev log operation name (defaults to tts.speech / tts.deck). */
  logOperation?: string;
  /** Dev log scope metadata (unitId, goalId, …). */
  logMeta?: Record<string, unknown>;
  /** Fetch MiniMax subtitle_file and map sentence timings onto local char spans. */
  subtitleEnable?: boolean;
};

export const DEFAULT_MINIMAX_TTS_VOICE_PRESET: MinimaxTtsVoicePresetCode =
  "college_student";

export const DEFAULT_MINIMAX_TTS_NARRATION_STYLE: MinimaxTtsNarrationStyleCode =
  "auto";

export const DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST: MinimaxTtsLanguageBoost =
  "auto";

const CONTENT_LANGUAGE_TO_MINIMAX_BOOST: Partial<
  Record<ContentLanguageCode, MinimaxTtsLanguageBoost>
> = {
  "zh-Hans": "Chinese",
  "zh-Hant": "Chinese",
  en: "English",
  ja: "Japanese",
  ko: "Korean",
  es: "Spanish",
  fr: "French",
  de: "German",
};

export function contentLanguageToMinimaxLanguageBoost(
  code: ContentLanguageCode,
): MinimaxTtsLanguageBoost {
  return CONTENT_LANGUAGE_TO_MINIMAX_BOOST[code] ?? "auto";
}

/**
 * MiniMax system voice IDs per language × narration role.
 * @see https://platform.minimax.io/docs/faq/system-voice-id
 */
const LANGUAGE_VOICE_IDS: Record<
  string,
  Partial<Record<MinimaxTtsVoicePresetCode, string>>
> = {
  Chinese: {
    college_student: "male-qn-daxuesheng",
    young_girl: "female-shaonv",
    clever_boy: "clever_boy",
    lovely_girl: "lovely_girl",
    cute_spirit: "Chinese (Mandarin)_Cute_Spirit",
    funny_elder: "Chinese (Mandarin)_Humorous_Elder",
    pro_female_host: "Chinese (Mandarin)_News_Anchor",
    warm_girl: "Chinese (Mandarin)_Warm_Girl",
    radio_male_host: "Chinese (Mandarin)_Radio_Host",
  },
  "Chinese,Yue": {
    college_student: "Cantonese_PlayfulMan",
    young_girl: "Cantonese_CuteGirl",
    clever_boy: "Cantonese_PlayfulMan",
    lovely_girl: "Cantonese_CuteGirl",
    cute_spirit: "Cantonese_CuteGirl",
    funny_elder: "Cantonese_PlayfulMan",
    pro_female_host: "Cantonese_ProfessionalHost (F)",
    warm_girl: "Cantonese_GentleLady",
    radio_male_host: "Cantonese_ProfessionalHost (M)",
  },
  English: {
    college_student: "English_DecentYoungMan",
    young_girl: "English_Upbeat_Woman",
    clever_boy: "English_Diligent_Man",
    lovely_girl: "English_LovelyGirl",
    cute_spirit: "Cute_Elf",
    funny_elder: "English_FriendlyPerson",
    pro_female_host: "English_ConfidentWoman",
    warm_girl: "English_Graceful_Lady",
    radio_male_host: "English_Gentle-voiced_man",
  },
  Japanese: {
    college_student: "Japanese_OptimisticYouth",
    young_girl: "Japanese_GracefulMaiden",
    clever_boy: "Japanese_InnocentBoy",
    lovely_girl: "Japanese_GracefulMaiden",
    cute_spirit: "Japanese_GracefulMaiden",
    funny_elder: "Japanese_GenerousIzakayaOwner",
    pro_female_host: "Japanese_CalmLady",
    warm_girl: "Japanese_KindLady",
    radio_male_host: "Japanese_GentleButler",
  },
  Korean: {
    college_student: "Korean_OptimisticYouth",
    young_girl: "Korean_SweetGirl",
    clever_boy: "Korean_InnocentBoy",
    lovely_girl: "Korean_SweetGirl",
    cute_spirit: "Korean_QuirkyGirl",
    funny_elder: "Korean_WiseTeacher",
    pro_female_host: "Korean_ConfidentBoss",
    warm_girl: "Korean_SweetGirl",
    radio_male_host: "Korean_OptimisticYouth",
  },
  Spanish: {
    college_student: "Spanish_EnergeticBoy",
    young_girl: "Spanish_ConfidentWoman",
    clever_boy: "Spanish_EnergeticBoy",
    lovely_girl: "Spanish_Kind-heartedGirl",
    cute_spirit: "Spanish_EnergeticBoy",
    funny_elder: "Spanish_WiseScholar",
    pro_female_host: "Spanish_SophisticatedLady",
    warm_girl: "Spanish_Kind-heartedGirl",
    radio_male_host: "Spanish_Narrator",
  },
  French: {
    college_student: "French_CasualMan",
    young_girl: "French_MovieLeadFemale",
    clever_boy: "French_CasualMan",
    lovely_girl: "French_MovieLeadFemale",
    cute_spirit: "French_MovieLeadFemale",
    funny_elder: "French_MaleNarrator",
    pro_female_host: "French_FemaleAnchor",
    warm_girl: "French_MovieLeadFemale",
    radio_male_host: "French_MaleNarrator",
  },
  German: {
    college_student: "German_PlayfulMan",
    young_girl: "German_SweetLady",
    clever_boy: "German_PlayfulMan",
    lovely_girl: "German_SweetLady",
    cute_spirit: "German_SweetLady",
    funny_elder: "German_FriendlyMan",
    pro_female_host: "German_SweetLady",
    warm_girl: "German_SweetLady",
    radio_male_host: "German_FriendlyMan",
  },
  Portuguese: {
    college_student: "Portuguese_EnergeticBoy",
    young_girl: "Portuguese_SweetGirl",
    clever_boy: "Portuguese_EnergeticBoy",
    lovely_girl: "Portuguese_SweetGirl",
    cute_spirit: "Portuguese_SweetGirl",
    funny_elder: "Portuguese_WiseScholar",
    pro_female_host: "Portuguese_GorgeousLady",
    warm_girl: "Portuguese_LovelyLady",
    radio_male_host: "Portuguese_Narrator",
  },
  Italian: {
    college_student: "Italian_WanderingSorcerer",
    young_girl: "Italian_BraveHeroine",
    clever_boy: "Italian_WanderingSorcerer",
    lovely_girl: "Italian_BraveHeroine",
    cute_spirit: "Italian_BraveHeroine",
    funny_elder: "Italian_Narrator",
    pro_female_host: "Italian_BraveHeroine",
    warm_girl: "Italian_BraveHeroine",
    radio_male_host: "Italian_Narrator",
  },
  Russian: {
    college_student: "Russian_AttractiveGuy",
    young_girl: "Russian_BrightHeroine",
    clever_boy: "Russian_AttractiveGuy",
    lovely_girl: "Russian_BrightHeroine",
    cute_spirit: "Russian_BrightHeroine",
    funny_elder: "Russian_ReliableMan",
    pro_female_host: "Russian_AmbitiousWoman",
    warm_girl: "Russian_BrightHeroine",
    radio_male_host: "Russian_ReliableMan",
  },
  Arabic: {
    college_student: "Arabic_FriendlyGuy",
    young_girl: "Arabic_CalmWoman",
    clever_boy: "Arabic_FriendlyGuy",
    lovely_girl: "Arabic_CalmWoman",
    cute_spirit: "Arabic_CalmWoman",
    funny_elder: "Arabic_FriendlyGuy",
    pro_female_host: "Arabic_CalmWoman",
    warm_girl: "Arabic_CalmWoman",
    radio_male_host: "Arabic_FriendlyGuy",
  },
  Hindi: {
    college_student: "hindi_male_1_v2",
    young_girl: "hindi_female_2_v1",
    clever_boy: "hindi_male_1_v2",
    lovely_girl: "hindi_female_2_v1",
    cute_spirit: "hindi_female_2_v1",
    funny_elder: "hindi_male_1_v2",
    pro_female_host: "hindi_female_1_v2",
    warm_girl: "hindi_female_2_v1",
    radio_male_host: "hindi_male_1_v2",
  },
  Vietnamese: {
    college_student: "Vietnamese_kindhearted_girl",
    young_girl: "Vietnamese_kindhearted_girl",
    clever_boy: "Vietnamese_kindhearted_girl",
    lovely_girl: "Vietnamese_kindhearted_girl",
    cute_spirit: "Vietnamese_kindhearted_girl",
    funny_elder: "Vietnamese_kindhearted_girl",
    pro_female_host: "Vietnamese_kindhearted_girl",
    warm_girl: "Vietnamese_kindhearted_girl",
    radio_male_host: "Vietnamese_kindhearted_girl",
  },
  Indonesian: {
    college_student: "Indonesian_DeterminedBoy",
    young_girl: "Indonesian_SweetGirl",
    clever_boy: "Indonesian_DeterminedBoy",
    lovely_girl: "Indonesian_SweetGirl",
    cute_spirit: "Indonesian_CharmingGirl",
    funny_elder: "Indonesian_CaringMan",
    pro_female_host: "Indonesian_CalmWoman",
    warm_girl: "Indonesian_SweetGirl",
    radio_male_host: "Indonesian_CaringMan",
  },
  Thai: {
    college_student: "Thai_male_2_sample2",
    young_girl: "Thai_female_2_sample2",
    clever_boy: "Thai_male_2_sample2",
    lovely_girl: "Thai_female_1_sample1",
    cute_spirit: "Thai_female_2_sample2",
    funny_elder: "Thai_male_1_sample8",
    pro_female_host: "Thai_female_2_sample2",
    warm_girl: "Thai_female_2_sample2",
    radio_male_host: "Thai_male_2_sample2",
  },
  Turkish: {
    college_student: "Turkish_Trustworthyman",
    young_girl: "Turkish_CalmWoman",
    clever_boy: "Turkish_Trustworthyman",
    lovely_girl: "Turkish_CalmWoman",
    cute_spirit: "Turkish_CalmWoman",
    funny_elder: "Turkish_Trustworthyman",
    pro_female_host: "Turkish_CalmWoman",
    warm_girl: "Turkish_CalmWoman",
    radio_male_host: "Turkish_Trustworthyman",
  },
  Dutch: {
    college_student: "Dutch_bossy_leader",
    young_girl: "Dutch_kindhearted_girl",
    clever_boy: "Dutch_bossy_leader",
    lovely_girl: "Dutch_kindhearted_girl",
    cute_spirit: "Dutch_kindhearted_girl",
    funny_elder: "Dutch_bossy_leader",
    pro_female_host: "Dutch_kindhearted_girl",
    warm_girl: "Dutch_kindhearted_girl",
    radio_male_host: "Dutch_bossy_leader",
  },
  Polish: {
    college_student: "Polish_male_2_sample3",
    young_girl: "Polish_female_2_sample3",
    clever_boy: "Polish_male_2_sample3",
    lovely_girl: "Polish_female_1_sample1",
    cute_spirit: "Polish_female_2_sample3",
    funny_elder: "Polish_male_1_sample4",
    pro_female_host: "Polish_female_2_sample3",
    warm_girl: "Polish_female_2_sample3",
    radio_male_host: "Polish_male_2_sample3",
  },
  Ukrainian: {
    college_student: "Ukrainian_WiseScholar",
    young_girl: "Ukrainian_CalmWoman",
    clever_boy: "Ukrainian_WiseScholar",
    lovely_girl: "Ukrainian_CalmWoman",
    cute_spirit: "Ukrainian_CalmWoman",
    funny_elder: "Ukrainian_WiseScholar",
    pro_female_host: "Ukrainian_CalmWoman",
    warm_girl: "Ukrainian_CalmWoman",
    radio_male_host: "Ukrainian_WiseScholar",
  },
  Romanian: {
    college_student: "Romanian_male_2_sample1",
    young_girl: "Romanian_female_2_sample1",
    clever_boy: "Romanian_male_2_sample1",
    lovely_girl: "Romanian_female_1_sample4",
    cute_spirit: "Romanian_female_1_sample4",
    funny_elder: "Romanian_male_1_sample2",
    pro_female_host: "Romanian_female_2_sample1",
    warm_girl: "Romanian_female_2_sample1",
    radio_male_host: "Romanian_male_2_sample1",
  },
  Greek: {
    college_student: "greek_male_1a_v1",
    young_girl: "Greek_female_2_sample3",
    clever_boy: "greek_male_1a_v1",
    lovely_girl: "Greek_female_1_sample1",
    cute_spirit: "Greek_female_2_sample3",
    funny_elder: "greek_male_1a_v1",
    pro_female_host: "Greek_female_1_sample1",
    warm_girl: "Greek_female_2_sample3",
    radio_male_host: "greek_male_1a_v1",
  },
  Czech: {
    college_student: "czech_male_1_v1",
    young_girl: "czech_female_2_v2",
    clever_boy: "czech_male_1_v1",
    lovely_girl: "czech_female_2_v2",
    cute_spirit: "czech_female_2_v2",
    funny_elder: "czech_male_1_v1",
    pro_female_host: "czech_female_2_v2",
    warm_girl: "czech_female_2_v2",
    radio_male_host: "czech_male_1_v1",
  },
  Finnish: {
    college_student: "finnish_male_1_v2",
    young_girl: "finnish_female_4_v1",
    clever_boy: "finnish_male_1_v2",
    lovely_girl: "finnish_female_4_v1",
    cute_spirit: "finnish_female_4_v1",
    funny_elder: "finnish_male_3_v1",
    pro_female_host: "finnish_female_4_v1",
    warm_girl: "finnish_female_4_v1",
    radio_male_host: "finnish_male_1_v2",
  },
};

/** When language is auto-detected, default to Mandarin voices (primary app locale). */
const AUTO_LANGUAGE_VOICE_KEY = "Chinese";

const LEGACY_VOICE_PRESET_CODES: Partial<
  Record<string, MinimaxTtsVoicePresetCode>
> = {
  warm_female: "warm_girl",
  mature_female: "pro_female_host",
  clear_male: "college_student",
  professional_male: "college_student",
  energetic_female: "young_girl",
  young_male: "college_student",
  news_anchor: "pro_female_host",
  radio_host: "radio_male_host",
  male_announcer: "college_student",
  intellectual_female: "pro_female_host",
  sweet_lady: "lovely_girl",
  wise_female: "pro_female_host",
  gentle_senior: "college_student",
  kind_elder: "funny_elder",
  soft_female: "young_girl",
  sincere_adult: "college_student",
};

function normalizeVoicePresetCode(code: unknown): unknown {
  if (typeof code === "string" && code in LEGACY_VOICE_PRESET_CODES) {
    return LEGACY_VOICE_PRESET_CODES[code];
  }
  return code;
}

function languageKeyForVoice(languageBoost: string): string {
  if (languageBoost === "auto") return AUTO_LANGUAGE_VOICE_KEY;
  return LANGUAGE_VOICE_IDS[languageBoost] ? languageBoost : "English";
}

function resolveVoiceId(
  role: MinimaxTtsVoicePresetCode,
  languageBoost: string,
): string {
  const langKey = languageKeyForVoice(languageBoost);
  const map = LANGUAGE_VOICE_IDS[langKey] ?? LANGUAGE_VOICE_IDS.English!;
  return (
    map[role] ??
    map.college_student ??
    Object.values(map).find(Boolean) ??
    LANGUAGE_VOICE_IDS.Chinese!.college_student!
  );
}

function clampTtsSpeed(value: number): number {
  return Math.min(2, Math.max(0.5, value));
}

function clampTtsPitch(value: number): number {
  return Math.min(12, Math.max(-12, value));
}

const NARRATION_STYLE_BY_CODE: Record<
  MinimaxTtsNarrationStyleCode,
  MinimaxTtsNarrationStyle
> = {
  auto: { code: "auto", speedOffset: 0, pitchOffset: 0 },
  calm: { code: "calm", emotion: "calm", speedOffset: 0, pitchOffset: 0 },
  fluent: {
    code: "fluent",
    emotion: "fluent",
    speedOffset: 0,
    pitchOffset: 0,
  },
  happy: { code: "happy", emotion: "happy", speedOffset: 0, pitchOffset: 0 },
  serious: {
    code: "serious",
    emotion: "calm",
    speedOffset: -0.04,
    pitchOffset: -1,
  },
};

export function resolveMinimaxTtsNarrationStyle(
  code: unknown,
): MinimaxTtsNarrationStyle {
  if (typeof code === "string" && code in NARRATION_STYLE_BY_CODE) {
    return NARRATION_STYLE_BY_CODE[code as MinimaxTtsNarrationStyleCode];
  }
  return NARRATION_STYLE_BY_CODE.auto;
}

export function resolveMinimaxTtsVoicePreset(
  code: unknown,
  languageBoost?: unknown,
  voiceId?: unknown,
): MinimaxTtsVoicePreset {
  const normalized = normalizeVoicePresetCode(code);
  const role =
    typeof normalized === "string"
      ? (MINIMAX_TTS_VOICE_PRESETS.find((item) => item.code === normalized) ??
        MINIMAX_TTS_VOICE_PRESETS[0])
      : MINIMAX_TTS_VOICE_PRESETS[0];
  const lang = resolveMinimaxTtsLanguageBoost(languageBoost);
  return {
    ...role,
    voiceId:
      typeof voiceId === "string" && voiceId.trim()
        ? voiceId.trim()
        : resolveVoiceId(role.code, lang),
  };
}

export function resolveMinimaxTtsLanguageBoost(code: unknown): string {
  if (typeof code === "string") {
    const option = MINIMAX_TTS_LANGUAGE_OPTIONS.find(
      (item) => item.code === code,
    );
    if (option) return option.code;
  }
  return DEFAULT_MINIMAX_TTS_LANGUAGE_BOOST;
}

/** Presets that have a dedicated voice for the given language (for UI filtering). */
export function applyNarrationStyleToVoice(
  voice: Pick<MinimaxTtsVoicePreset, "speed" | "pitch" | "vol">,
  narration: MinimaxTtsNarrationStyle,
): { speed: number; pitch: number; vol: number; emotion?: string } {
  return {
    speed: clampTtsSpeed(voice.speed + narration.speedOffset),
    pitch: clampTtsPitch(voice.pitch + narration.pitchOffset),
    vol: voice.vol,
    ...(narration.emotion ? { emotion: narration.emotion } : {}),
  };
}

export function voicePresetsForLanguage(languageBoost: unknown) {
  const lang = resolveMinimaxTtsLanguageBoost(languageBoost);
  const langKey = languageKeyForVoice(lang);
  const map = LANGUAGE_VOICE_IDS[langKey];
  if (!map) return [...MINIMAX_TTS_VOICE_PRESETS];
  const available = new Set(
    MINIMAX_TTS_VOICE_PRESETS.filter((preset) => map[preset.code]),
  );
  return available.size > 0 ? [...available] : [...MINIMAX_TTS_VOICE_PRESETS];
}

export function narrationStyleForVoicePreset(
  code: unknown,
): MinimaxTtsNarrationStyleCode {
  const preset =
    typeof code === "string"
      ? MINIMAX_TTS_VOICE_PRESETS.find((item) => item.code === code)
      : undefined;
  return preset?.narrationStyle ?? DEFAULT_MINIMAX_TTS_NARRATION_STYLE;
}
