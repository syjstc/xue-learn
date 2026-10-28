export const audioProviderIds = [
  "minimax",
  "doubao",
  "qwen",
  "cartesia",
] as const;
export type AudioProviderId = (typeof audioProviderIds)[number];
