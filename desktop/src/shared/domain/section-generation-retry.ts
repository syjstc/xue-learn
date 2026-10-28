export function sectionGenerateStreamBody(input: {
  force?: boolean;
  rewrite?: { topicId?: string; topicIndex: number };
  derivationFormat?: "classic" | "teaching_v1";
}): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (input.force) body.force = true;
  if (input.rewrite) {
    if (input.rewrite.topicId) body.topicId = input.rewrite.topicId;
    body.topicIndex = input.rewrite.topicIndex;
  }
  if (input.derivationFormat === "teaching_v1") {
    body.derivationFormat = "teaching_v1";
  }
  return body;
}

/** Wipe the on-screen draft only for whole-section regenerate, not retry/resume. */
export function shouldClearSectionContentBeforeGenerate(input: {
  force?: boolean;
  rewrite?: boolean;
}): boolean {
  return Boolean(input.force) && !input.rewrite;
}

/**
 * Start generate/stream. Failed-section retry must pass `resume` without
 * `force` so accepted topic commits are kept.
 */
export function shouldStartSectionGenerateStream(input: {
  generateWhenMissing: boolean;
  force?: boolean;
  rewrite?: boolean;
  resume?: boolean;
  generationStatus: string;
  hasStoredContent: boolean;
  pendingDerivation?: boolean;
}): boolean {
  if (!input.generateWhenMissing) return false;
  const requested =
    Boolean(input.force) || Boolean(input.rewrite) || Boolean(input.resume);
  if (!requested && input.generationStatus === "failed") return false;
  return (
    requested ||
    !input.hasStoredContent ||
    Boolean(input.pendingDerivation)
  );
}
