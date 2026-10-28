export const PYTHON_EDITOR_FOLLOW_UP_OWNER = "desktop-python-editor";

export const PYTHON_ASK_AI_INTRO =
  "I ran this Python snippet in the desktop playground and need help.";

export type PythonAskAiPayload = {
  code: string;
  output: string;
};

const ASK_AI_PATTERN = new RegExp(
  `^${escapeRegExp(PYTHON_ASK_AI_INTRO)}\\n\\n\`\`\`python\\n([\\s\\S]*?)\\n\`\`\`\\n\\nRuntime output:\\n\`\`\`\\n([\\s\\S]*?)\\n\`\`\`\\s*$`,
);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatPythonAskAiMessage(input: {
  code: string;
  output: string;
}): string {
  const code = input.code.trim() || "(empty)";
  const output = input.output.trim() || "(no output)";
  return [
    PYTHON_ASK_AI_INTRO,
    "",
    "```python",
    code,
    "```",
    "",
    "Runtime output:",
    "```",
    output,
    "```",
  ].join("\n");
}

export function parsePythonAskAiMessage(
  content: string,
): PythonAskAiPayload | null {
  const match = ASK_AI_PATTERN.exec(content.trim());
  if (!match) return null;
  return { code: match[1] ?? "", output: match[2] ?? "" };
}

export function formatPythonAskAiPreview(payload: PythonAskAiPayload): string {
  const preview = payload.output.replace(/\s+/g, " ").trim();
  if (!preview || preview === "(no output)") return "Python";
  return preview.length > 48 ? `${preview.slice(0, 48)}…` : preview;
}

export function formatPythonConsoleText(
  lines: ReadonlyArray<{ stream: string; text: string }>,
): string {
  return lines.map((line) => line.text).join("");
}
