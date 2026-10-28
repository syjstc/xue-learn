const MAX_PRIOR_SECTIONS = 24;
const MAX_CONTEXT_CHARS = 12_000;
const MAX_SECTION_CHARS = 1_200;

function compact(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return `${text.slice(0, budget - 1).trimEnd()}…`;
}

function uniqueText(values: unknown[]): string[] {
  return [
    ...new Set(values.flatMap((value) => {
      if (typeof value !== "string") return [];
      const text = value.replace(/\s+/g, " ").trim();
      return text ? [text] : [];
    })),
  ];
}

/** Sample across the section so a long opening cannot hide every later result. */
function sampleEvidence(values: string[], budget: number): string {
  const complete = values.join("\n");
  if (complete.length <= budget) return complete;
  const count = Math.min(values.length, 3);
  if (!count) return "";
  const itemBudget = Math.floor((budget - (count - 1)) / count);
  return Array.from({ length: count }, (_, index) => {
    const sourceIndex = count === 1
      ? 0
      : Math.round((index * (values.length - 1)) / (count - 1));
    return compact(values[sourceIndex], itemBudget);
  }).join("\n");
}

/** Bounded excerpts are evidence of teaching, not proof of learner mastery. */
export function formatPriorTeaching(
  rows: readonly {
    title: string;
    blocks: unknown;
    keyTakeaways: unknown;
    contentRevision: number;
  }[],
): string {
  const sections = rows
    .slice(-MAX_PRIOR_SECTIONS)
    .map((row) => {
      const blocks = Array.isArray(row.blocks) ? row.blocks : [];
      const excerpts = uniqueText(
        blocks.flatMap((block: unknown) => {
          if (!block || typeof block !== "object") return [];
          const record = block as Record<string, unknown>;
          if (record.type !== "paragraph") return [];
          return typeof record.text === "string" ? [record.text] : [];
        }),
      );
      const takeaways = Array.isArray(row.keyTakeaways)
        ? uniqueText(row.keyTakeaways)
        : [];
      return {
        row,
        takeaways,
        excerpts: excerpts.filter((text) => !takeaways.includes(text)),
      };
    })
    .filter(({ takeaways, excerpts }) => takeaways.length || excerpts.length);
  // Reserve space for every eligible section, rather than tail-slicing away
  // earlier foundations (and sometimes their title/revision) after formatting.
  const sectionBudget = Math.min(
    MAX_SECTION_CHARS,
    Math.floor(
      (MAX_CONTEXT_CHARS - Math.max(0, sections.length - 1) * 2)
        / Math.max(1, sections.length),
    ),
  );
  const lines = sections.map(({ row, takeaways, excerpts }) => {
    const heading = `${compact(row.title, 180)} (content revision ${row.contentRevision}):\n`;
    const evidenceBudget = sectionBudget - heading.length;
    const groups = [takeaways, excerpts].filter((values) => values.length);
    const groupBudget = Math.floor(
      (evidenceBudget - (groups.length - 1)) / groups.length,
    );
    return heading + groups
      .map((values) => sampleEvidence(values, groupBudget))
      .join("\n");
  });
  return `[Actual earlier teaching excerpts — incomplete, not a mastery certificate]
${lines.join("\n\n") || "No usable earlier teaching evidence is available."}
Use the evidenced definitions and results as continuity and repetition boundaries: recall only what the current task needs in one or two short sentences, then teach the new contribution. Do not replay earlier explanations or worked examples. Taught content is not a mastery claim; missing mastery evidence alone is not a reason to reteach it.
Do not infer taught knowledge from a title or an omitted excerpt. Where the needed foundation is not established here or in accepted earlier teaching in this conversation, explain the minimum foundation BEFORE its first use, not the whole earlier lesson. Previews are not taught prerequisites.`;
}
