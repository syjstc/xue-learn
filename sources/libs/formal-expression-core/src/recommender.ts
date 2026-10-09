import type { OperationRecommender } from "./types.js";
export const recentOperationRecommender: OperationRecommender = {
  recommend({ document, history, selection }) {
    const selected = selection?.find((s) => s.type === "node");
    const last = history.entries.find((e) => e.id === history.currentId);
    const suggestions = [];
    if (selected && document.nodes[selected.id])
      suggestions.push({
        id: "edit-content",
        label: "Edit selected content",
        command: {
          type: "setContent",
          id: selected.id,
          value: document.nodes[selected.id].value ?? "",
        },
        reason: "A node is selected",
      });
    if (
      last?.command.type === "setContent" &&
      typeof last.command.id === "string"
    )
      suggestions.push({
        id: "edit-again",
        label: "Edit the same node again",
        command: {
          type: "setContent",
          id: last.command.id,
          value: document.nodes[last.command.id]?.value ?? "",
        },
        reason: "Based on the latest operation",
      });
    return suggestions;
  },
};
