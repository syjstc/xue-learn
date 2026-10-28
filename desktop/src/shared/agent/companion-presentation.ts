export type CompanionTab = "document" | "editor" | "assistant";

export function resolveCompanionPresentation(input: {
  documentOpen: boolean;
  editorOpen: boolean;
  assistantOpen: boolean;
  activeView: CompanionTab;
}): {
  showTabs: boolean;
  surfaceCount: number;
  activeTab: CompanionTab | null;
  visibleDocument: boolean;
  visibleEditor: boolean;
  visibleAssistant: boolean;
} {
  const available: CompanionTab[] = [];
  if (input.documentOpen) available.push("document");
  if (input.editorOpen) available.push("editor");
  if (input.assistantOpen) available.push("assistant");
  const activeTab = available.includes(input.activeView)
    ? input.activeView
    : (available[0] ?? null);

  return {
    showTabs: available.length >= 2,
    surfaceCount: available.length,
    activeTab,
    visibleDocument: activeTab === "document",
    visibleEditor: activeTab === "editor",
    visibleAssistant: activeTab === "assistant",
  };
}
