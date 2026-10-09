export const searchProviderIds = ["tavily", "doubao", "anysearch"] as const;
export type SearchProviderId = (typeof searchProviderIds)[number];
