/** Heuristic: goal title implies an itemized catalog (numbered anthology, word list, etc.). */
export function isItemizedCatalogGoal(title: string): boolean {
  return /(\d+)\s*(首|个|条|篇|词|字|words?|poems?|items?)|三百|五百|一千/i.test(
    title,
  );
}

export function catalogSearchQuery(title: string): string {
  return `${title} 完整目录 列表 全集 table of contents`;
}
