type SelectOption = {
  value: string;
  label: string;
};

function scalarValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    return text || undefined;
  }

  if (!value || typeof value !== "object") return undefined;

  const option = value as Record<string, unknown>;
  for (const key of ["value", "code", "id", "label", "text"]) {
    const text = scalarValue(option[key]);
    if (text) return text;
  }
  return undefined;
}

/**
 * Collect-form defaults can come from an LLM-authored object in legacy or
 * in-flight sessions. Resolve those option objects before they reach a
 * controlled input; otherwise React/Base UI renders "[object Object]".
 */
export function normalizeCollectFormOption(
  value: unknown,
  options: readonly SelectOption[],
  fallback: string,
): string {
  const raw = scalarValue(value);
  if (!raw) return fallback;
  return (
    options.find((option) => option.value === raw || option.label === raw)
      ?.value ?? fallback
  );
}

export function collectFormOptionText(value: unknown): string {
  return scalarValue(value) ?? "";
}
