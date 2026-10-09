export const doubaoThinkingModes = ["enabled", "disabled", "auto"] as const;
export type DoubaoThinkingMode = (typeof doubaoThinkingModes)[number];

export const DOUBAO_THINKING_MODE_LABELS: Record<
  DoubaoThinkingMode,
  { title: string; description: string }
> = {
  enabled: {
    title: "开启",
    description: "模型先思考再回答（thinking.type=enabled）",
  },
  disabled: {
    title: "关闭",
    description: "直接回答，更快更省（thinking.type=disabled）",
  },
  auto: {
    title: "自动",
    description: "由模型判断是否思考（thinking.type=auto）",
  },
};

/** Seed-series Doubao models expose Ark `thinking` controls. */
export function doubaoThinkingConfigurable(model: string): boolean {
  const normalized = model.trim().toLowerCase();
  return (
    normalized.startsWith("doubao-seed-") || normalized === "doubao-seed-evolving"
  );
}

export function parseDoubaoThinkingMode(
  value: string | null | undefined,
): DoubaoThinkingMode {
  if (value === "disabled" || value === "auto") return value;
  return "enabled";
}
