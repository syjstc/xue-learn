/**
 * Curated MiniMax Mandarin system voice ids for teaching-persona chat narration.
 *
 * Coding agents / maintainers: change a teacher's MiniMax voice by updating
 * `BUILTIN_CHAT_VOICE_BY_AVATAR` below, picking `voiceId` only from
 * `MINIMAX_MANDARIN_TEACHER_VOICE_CATALOG` (or add a documented id there first).
 *
 * Official catalog: https://platform.minimax.io/docs/faq/system-voice-id
 */

export type MinimaxTeacherVoiceGender = "female" | "male" | "neutral";

export type MinimaxTeacherVoiceCatalogEntry = {
  voiceId: string;
  /** Short Chinese label for humans / LLM pickers. */
  labelZh: string;
  gender: MinimaxTeacherVoiceGender;
  /** One-line English note for agent selection. */
  note: string;
};

/**
 * Allowlisted MiniMax Mandarin voices suitable for XueLearn teachers.
 * Prefer female/male teaching-tone ids; avoid cartoon/child novelty voices.
 */
export const MINIMAX_MANDARIN_TEACHER_VOICE_CATALOG = [
  {
    voiceId: "female-shaonv",
    labelZh: "耐心老师",
    gender: "female",
    note: "Clear, warm, measured — default for 小慧; e-learning tone",
  },
  {
    voiceId: "Chinese (Mandarin)_Warm_Girl",
    labelZh: "温暖少女",
    gender: "female",
    note: "Warm young female; friendly support",
  },
  {
    voiceId: "Chinese (Mandarin)_Gentle_Senior",
    labelZh: "温柔学姐",
    gender: "female",
    note: "Gentle senior-sister; calm campus support",
  },
  {
    voiceId: "Chinese (Mandarin)_IntellectualGirl",
    labelZh: "知性少女",
    gender: "female",
    note: "Intellectual girl; precise explanation",
  },
  {
    voiceId: "Chinese (Mandarin)_News_Anchor",
    labelZh: "新闻女声",
    gender: "female",
    note: "Polished news anchor; clear delivery",
  },
  {
    voiceId: "Chinese (Mandarin)_Wise_Women",
    labelZh: "阅历姐姐",
    gender: "female",
    note: "Experienced sister; measured guidance",
  },
  {
    voiceId: "Chinese (Mandarin)_Soft_Girl",
    labelZh: "柔和少女",
    gender: "female",
    note: "Soft young female; gentle narration",
  },
  {
    voiceId: "Chinese (Mandarin)_Warm_Bestie",
    labelZh: "温暖闺蜜",
    gender: "female",
    note: "Warm bestie; peer-like support",
  },
  {
    voiceId: "Chinese (Mandarin)_Sweet_Lady",
    labelZh: "甜美女声",
    gender: "female",
    note: "Sweet lady; lighter tone",
  },
  {
    voiceId: "Chinese (Mandarin)_ExplorativeGirl",
    labelZh: "探索少女",
    gender: "female",
    note: "Explorative girl; curious energy",
  },
  {
    voiceId: "Chinese (Mandarin)_Laid_BackGirl",
    labelZh: "慵懒少女",
    gender: "female",
    note: "Laid-back girl; relaxed comedy pair",
  },
  {
    voiceId: "Arrogant_Miss",
    labelZh: "傲娇小姐",
    gender: "female",
    note: "Bright playful miss; sharper character",
  },
  {
    voiceId: "Chinese (Mandarin)_Mature_Woman",
    labelZh: "傲娇御姐",
    gender: "female",
    note: "Mature woman; assertive presence",
  },
  {
    voiceId: "Chinese (Mandarin)_Gentleman",
    labelZh: "温润男声",
    gender: "male",
    note: "Gentleman; warm refined male default",
  },
  {
    voiceId: "Chinese (Mandarin)_Reliable_Executive",
    labelZh: "沉稳高管",
    gender: "male",
    note: "Reliable executive; calm authority",
  },
  {
    voiceId: "Chinese (Mandarin)_Straightforward_Boy",
    labelZh: "率真弟弟",
    gender: "male",
    note: "Straightforward boy; direct casual",
  },
  {
    voiceId: "Chinese (Mandarin)_Unrestrained_Young_Man",
    labelZh: "不羁青年",
    gender: "male",
    note: "Unrestrained young man; bold energy",
  },
  {
    voiceId: "danya_xuejie",
    labelZh: "淡雅学姐",
    gender: "female",
    note: "Danya senior-sister; calm sharp teacher",
  },
  {
    voiceId: "Chinese (Mandarin)_Humorous_Elder",
    labelZh: "幽默大爷",
    gender: "male",
    note: "Humorous elder; comedy pair",
  },
  {
    voiceId: "Chinese (Mandarin)_Stubborn_Friend",
    labelZh: "嘴硬竹马",
    gender: "male",
    note: "Stubborn friend; sharp male pair",
  },
  {
    voiceId: "Chinese (Mandarin)_Sincere_Adult",
    labelZh: "真诚青年",
    gender: "male",
    note: "Sincere adult; earnest teaching",
  },
  {
    voiceId: "Chinese (Mandarin)_Radio_Host",
    labelZh: "电台男主播",
    gender: "male",
    note: "Radio host; conversational male",
  },
  {
    voiceId: "Chinese (Mandarin)_Gentle_Youth",
    labelZh: "温润青年",
    gender: "male",
    note: "Gentle youth; soft male narration",
  },
] as const satisfies readonly MinimaxTeacherVoiceCatalogEntry[];

export type MinimaxTeacherCatalogVoiceId =
  (typeof MINIMAX_MANDARIN_TEACHER_VOICE_CATALOG)[number]["voiceId"];

export type BuiltinChatVoiceProfile = {
  voicePreset:
    | "warm_girl"
    | "radio_male_host"
    | "pro_female_host"
    | "young_girl"
    | "funny_elder";
  voiceId: MinimaxTeacherCatalogVoiceId;
  narrationStyle: "auto" | "calm" | "happy";
};

/** Built-in avatarCode → MiniMax chat-narration voice. */
export const BUILTIN_CHAT_VOICE_BY_AVATAR: Record<
  string,
  BuiltinChatVoiceProfile
> = {
  xiaohui_female: {
    voicePreset: "warm_girl",
    voiceId: "female-shaonv",
    narrationStyle: "auto",
  },
  xiaohui: {
    voicePreset: "radio_male_host",
    voiceId: "Chinese (Mandarin)_Gentleman",
    narrationStyle: "auto",
  },
  zhiheng_female: {
    voicePreset: "pro_female_host",
    voiceId: "Chinese (Mandarin)_IntellectualGirl",
    narrationStyle: "calm",
  },
  zhiheng: {
    voicePreset: "radio_male_host",
    voiceId: "Chinese (Mandarin)_Reliable_Executive",
    narrationStyle: "calm",
  },
  lixing_female: {
    voicePreset: "pro_female_host",
    voiceId: "Chinese (Mandarin)_News_Anchor",
    narrationStyle: "calm",
  },
  lixing: {
    voicePreset: "radio_male_host",
    voiceId: "Chinese (Mandarin)_Straightforward_Boy",
    narrationStyle: "auto",
  },
  tuoye_female: {
    voicePreset: "young_girl",
    voiceId: "Chinese (Mandarin)_ExplorativeGirl",
    narrationStyle: "auto",
  },
  tuoye: {
    voicePreset: "radio_male_host",
    voiceId: "Chinese (Mandarin)_Unrestrained_Young_Man",
    narrationStyle: "auto",
  },
  quzhi_female: {
    voicePreset: "young_girl",
    voiceId: "Chinese (Mandarin)_Laid_BackGirl",
    narrationStyle: "happy",
  },
  quzhi: {
    voicePreset: "funny_elder",
    voiceId: "Chinese (Mandarin)_Humorous_Elder",
    narrationStyle: "happy",
  },
  ruiyan_female: {
    voicePreset: "pro_female_host",
    voiceId: "danya_xuejie",
    narrationStyle: "calm",
  },
  ruiyan: {
    voicePreset: "radio_male_host",
    voiceId: "Chinese (Mandarin)_Stubborn_Friend",
    narrationStyle: "calm",
  },
  ruiyan_shadow_female: {
    voicePreset: "pro_female_host",
    voiceId: "danya_xuejie",
    narrationStyle: "calm",
  },
  ruiyan_shadow: {
    voicePreset: "radio_male_host",
    voiceId: "Chinese (Mandarin)_Stubborn_Friend",
    narrationStyle: "calm",
  },
};

/** Compact multiline catalog for agent / LLM reference prompts. */
export function formatMinimaxTeacherVoiceCatalogForLlm(): string {
  return MINIMAX_MANDARIN_TEACHER_VOICE_CATALOG.map(
    (entry) =>
      `- ${entry.voiceId} | ${entry.labelZh} | ${entry.gender} | ${entry.note}`,
  ).join("\n");
}
