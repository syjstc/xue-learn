const CUSTOM_CHOICE_PREFIX =
  /^(?:其他|其它|自定义|自己输入)(?:$|[\s,，、:：(/（])/u;

export function isCustomChoice(choice: string): boolean {
  return CUSTOM_CHOICE_PREFIX.test(choice.trim());
}

export function visibleChoiceLabels(choices: string[] | undefined): string[] {
  return (choices ?? []).filter((choice) => !isCustomChoice(choice));
}

export function customInputValue(
  choices: string[] | undefined,
  answer: string | string[] | undefined,
): string {
  const visible = new Set(visibleChoiceLabels(choices));
  if (Array.isArray(answer)) {
    return answer.find((item) => !visible.has(item)) ?? "";
  }
  if (typeof answer === "string" && answer.trim() && !visible.has(answer)) {
    return answer;
  }
  return "";
}

export function commitDiscoveryAnswer(
  question: { id: string; answerKind: string; choices?: string[] },
  answers: Record<string, string | string[]>,
  draft: string | undefined,
): Record<string, string | string[]> {
  const trimmed = draft?.trim() ?? "";
  if (!trimmed) return answers;
  if (question.answerKind === "multi_choice") {
    const visible = new Set(visibleChoiceLabels(question.choices));
    const current = answers[question.id];
    const selected = Array.isArray(current) ? current : [];
    const presets = selected.filter((item) => visible.has(item));
    const next = presets.includes(trimmed) ? presets : [...presets, trimmed];
    return { ...answers, [question.id]: next };
  }
  return { ...answers, [question.id]: trimmed };
}
