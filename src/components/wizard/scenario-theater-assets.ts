/** Maps generic avatar keys to their teaching-persona filename stems. */
export const SCENARIO_AVATARS = {
  mentor: "xiaohui",
  peer: "quzhi",
  client: "zhiheng",
  expert: "lixing",
  system: "tuoye",
} as const;

/** Maps generic avatar keys to their standing-image filename stems. */
export const SCENARIO_STANDINGS = {
  mentor: "xiaohui",
  peer: "quzhi",
  client: "zhiheng",
  expert: "lixing",
  system: "tuoye",
} as const;

/** Codes that have dedicated full-body coach art. */
export const COACH_STANDING_CODES = new Set([
  "xiaohui",
  "xiaohui_female",
  "zhiheng",
  "zhiheng_female",
  "lixing",
  "lixing_female",
  "tuoye",
  "tuoye_female",
  "quzhi",
  "quzhi_female",
  "ruiyan",
  "ruiyan_female",
]);
