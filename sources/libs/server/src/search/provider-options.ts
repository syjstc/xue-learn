import type { SearchProviderId } from "./provider-ids.js";

export type SearchProviderOption = {
  id: SearchProviderId;
  label: string;
  description: string;
};

/** @see https://www.volcengine.com/docs/87772/2548026 */
/** @see https://anysearch.com/docs */
export const SEARCH_PROVIDER_OPTIONS: SearchProviderOption[] = [
  {
    id: "tavily",
    label: "Tavily",
    description: "国际网页搜索，支持摘要与页面正文提取",
  },
  {
    id: "doubao",
    label: "豆包搜索",
    description: "火山引擎豆包搜索 Global 版，文本网页检索（按量后付费 API Key）",
  },
  {
    id: "anysearch",
    label: "AnySearch",
    description: "Agent 搜索基础设施，通用网页检索与页面正文提取（ANYSEARCH_API_KEY）",
  },
];

export function getSearchProviderOption(id: SearchProviderId) {
  return SEARCH_PROVIDER_OPTIONS.find((p) => p.id === id);
}
