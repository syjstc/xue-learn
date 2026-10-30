export type LearnerFacingContentIssue = {
  path: (string | number)[];
  message: string;
};

export type LearnerFacingContentOptions = {
  internalIds?: readonly string[];
  /** Identifiers present in the actual program are legitimate teaching evidence. */
  sourceIdentifiers?: ReadonlySet<string>;
};

const internalRef = /\b(?:lt_\d+(?::c\d+)?|component_[1-8]|shot_\d+(?:_beat_\d+)?|teaching:[\w:-]+|templateId|targetIds|topicId|sectionId|focusIds|sourceScope|hostOwnedSource|regionIntents|pendingPreparation|commit_(?:section_topics|topic_material|section_material)|(?:display|teaching-template|motion-scene)\.v\d+)\b/gi;
const authoringNote = /不(?:再)?重教|无需重教|(?:已接受|已提交|冻结)(?:的)?(?:教学内容|主题|讲稿|分镜)|\b(?:do not|don't|no need to)\s+(?:re-?teach|reteach)\b/i;
const referencedKey = /(?:已有|已在)\s*[`“"'「『]?\s*([a-z][a-z\d]*(?:[_:-][a-z\d]+)+)[`”"'」』]?\s*(?:中|里)|\balready taught in\s+[`"']?([a-z][a-z\d]*(?:[_:-][a-z\d]+)+)\b/gi;
const repairInstruction = "Learner-facing text must teach the subject, not expose internal references or authoring notes. Replace the internal ID with the concept's readable name and the needed fact or condition; apply continuity rules silently. Preserve the explanation, examples and qualifications, then resubmit the complete corrected content.";

/** Inspect prose without treating actual source code or mathematical notation as metadata. */
export function learnerFacingTextIssue(
  text: string,
  options: LearnerFacingContentOptions = {},
): string | undefined {
  const prose = text
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[^\n]*(?=\n|$)/g, " ")
    .replace(/\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g, " ");
  const source = options.sourceIdentifiers ?? new Set<string>();
  if (authoringNote.test(prose)) return repairInstruction;
  internalRef.lastIndex = 0;
  if ([...prose.matchAll(internalRef)].some(match => !source.has(match[0]))) return repairInstruction;
  for (const id of options.internalIds ?? []) {
    // Plain English words and single-letter names can be genuine lesson copy.
    if (!/[A-Za-z]/.test(id) || !/[_:-]|\d/.test(id) || source.has(id)) continue;
    const escaped = id.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&");
    if (new RegExp("(?<![A-Za-z\\d_:-])" + escaped + "(?![A-Za-z\\d_:-])", "i").test(prose))
      return repairInstruction;
  }
  referencedKey.lastIndex = 0;
  for (const match of prose.matchAll(referencedKey)) {
    if (!source.has(match[1] ?? match[2]!)) return repairInstruction;
  }
  return undefined;
}

const protocolFields = new Set([
  "id", "type", "kind", "role", "language", "topicId", "sectionId",
  "figureId", "partId", "anchorId", "imageId", "regionId", "beatId",
  "templateId", "targetIds", "focusIds", "regionIds", "slotRef", "componentId",
  "focus", "eventId", "clipId", "noteId", "noteIds", "part", "instrument", "clef",
  "action", "op", "operation", "phase", "target", "focusFormulaKey", "key",
  "from", "to", "source", "references", "symbols",
  "latex", "match", "prompt", "composition", "description", "observedDescription",
  "src", "imageUrl", "audioUrl", "layout", "direction", "preset",
  "build", "requirement", "targets",
  // Formula correspondence stores node IDs for entering/exiting glyphs.
  // These arrays are renderer references, just like beforeNodeId/afterNodeId.
  "unmatchedBefore", "unmatchedAfter",
]);
const identityFields = new Set([
  "id", "topicId", "sectionId", "figureId", "partId", "regionId", "beatId",
  "slotRef", "componentId", "key",
]);
const identifierField = (key: string) => /(?:Id|ID)s?$/.test(key);
const protocolField = (key: string) => protocolFields.has(key) || identifierField(key);

/** Authoring-only gate. Stored/read schemas must not use this to rewrite or reject saved lessons. */
export function learnerFacingContentIssues(
  value: unknown,
  options: LearnerFacingContentOptions = {},
): LearnerFacingContentIssue[] {
  const internalIds = new Set(options.internalIds);
  const sourceIdentifiers = new Set(options.sourceIdentifiers);
  const collect = (entry: unknown, programSource = false): void => {
    if (Array.isArray(entry)) return entry.forEach(child => collect(child, programSource));
    if (!entry || typeof entry !== "object") return;
    const record = entry as Record<string, unknown>;
    const program = record.language === "text" ? false : programSource || record.type === "code.v1"
      || typeof record.language === "string" && record.language !== "text"
        && (record.type === "code" || typeof record.code === "string" || Array.isArray(record.sections));
    for (const [key, child] of Object.entries(record)) {
      if (identityFields.has(key) || identifierField(key)) {
        if (typeof child === "string") internalIds.add(child);
        else if (Array.isArray(child)) for (const id of child) if (typeof id === "string") internalIds.add(id);
      }
      if (program && (key === "code" || key === "parts")) {
        const code = typeof child === "string" ? child
          : Array.isArray(child) ? child.map(part => (part as { text?: string })?.text ?? "").join("\n") : "";
        for (const token of code.match(/[A-Za-z_][A-Za-z\d_]*/g) ?? []) sourceIdentifiers.add(token);
      } else if (!protocolField(key)) collect(child, program);
    }
  };
  collect(value);
  const issues: LearnerFacingContentIssue[] = [];
  const visit = (entry: unknown, path: (string | number)[], programSource = false) => {
    if (typeof entry === "string") {
      const message = learnerFacingTextIssue(entry, { internalIds: [...internalIds], sourceIdentifiers });
      if (message) issues.push({ path, message });
    } else if (Array.isArray(entry)) entry.forEach((child, index) => visit(child, [...path, index], programSource));
    else if (entry && typeof entry === "object") {
      const record = entry as Record<string, unknown>;
      const program = record.language === "text" ? false : programSource || record.type === "code.v1"
        || typeof record.language === "string" && record.language !== "text"
          && (record.type === "code" || typeof record.code === "string" || Array.isArray(record.sections));
      for (const [key, child] of Object.entries(record)) {
        if (protocolField(key) || program && (key === "code" || key === "parts")) continue;
        if (key === "intent" && typeof child === "string") continue;
        // Music step/clip selections reference part or note IDs; their labels
        // live on the corresponding objects, not on these reference arrays.
        if (["parts", "notes"].includes(key) && Array.isArray(child)
          && child.every(item => typeof item === "string")) continue;
        visit(child, [...path, key], program);
      }
    }
  };
  visit(value, []);
  return issues;
}
