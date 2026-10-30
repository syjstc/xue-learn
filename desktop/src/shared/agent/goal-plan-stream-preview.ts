export type GoalPlanStreamModule = {
  title: string;
  summary: string;
};

export type GoalPlanStreamPreview = {
  refinedTitle: string;
  field: string;
  subdomain: string;
  learningMode: string;
  topicOverview: string;
  outcomes: string[];
  modules: GoalPlanStreamModule[];
  unitCount: number;
};

function decodeJsonString(value: string): string {
  try {
    return JSON.parse(`"${value}"`) as string;
  } catch {
    return value;
  }
}

function readStringProperty(source: string, key: string): string {
  const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const match = source.match(pattern);
  return match ? decodeJsonString(match[1]).trim() : "";
}

function propertyTail(source: string, key: string): string {
  const match = new RegExp(`"${key}"\\s*:\\s*`).exec(source);
  return match ? source.slice(match.index + match[0].length) : "";
}

function readStringArray(source: string, key: string): string[] {
  const tail = propertyTail(source, key);
  if (!tail) return [];
  const openIndex = tail.indexOf("[");
  if (openIndex < 0) return [];

  const values: string[] = [];
  const arraySource = tail.slice(openIndex + 1);
  let arrayEnd = arraySource.length;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < arraySource.length; index += 1) {
    const character = arraySource[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "]") {
      arrayEnd = index;
      break;
    }
  }
  const stringPattern = /"((?:\\.|[^"\\])*)"/g;
  let match: RegExpExecArray | null;
  while ((match = stringPattern.exec(arraySource.slice(0, arrayEnd)))) {
    values.push(decodeJsonString(match[1]).trim());
    if (values.length >= 12) break;
  }
  return values.filter(Boolean);
}

function readArrayObjectChunks(source: string, key: string): string[] {
  const tail = propertyTail(source, key);
  if (!tail) return [];
  const openIndex = tail.indexOf("[");
  if (openIndex < 0) return [];

  const chunks: string[] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex + 1; index < tail.length; index += 1) {
    const character = tail[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }
    if (character === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        chunks.push(tail.slice(objectStart, index + 1));
        objectStart = -1;
      }
      continue;
    }
    if (character === "]" && depth === 0) break;
  }

  // The current module can already contain a complete title/summary before its
  // closing brace arrives. Showing those completed strings is safe and useful.
  if (objectStart >= 0) chunks.push(tail.slice(objectStart));
  return chunks;
}

export function parseGoalPlanStreamPreview(
  source: string,
): GoalPlanStreamPreview {
  const domainSource = propertyTail(source, "domainAnalysis");
  const modules = readArrayObjectChunks(source, "modules")
    .map((chunk) => ({
      title: readStringProperty(chunk, "title"),
      summary: readStringProperty(chunk, "summary"),
    }))
    .filter((module) => module.title);

  return {
    refinedTitle: readStringProperty(source, "refinedTitle"),
    field: readStringProperty(domainSource, "field"),
    subdomain: readStringProperty(domainSource, "subdomain"),
    learningMode: readStringProperty(domainSource, "learningMode"),
    topicOverview: readStringProperty(source, "topicOverview"),
    outcomes: readStringArray(source, "whatYouWillLearn"),
    modules,
    unitCount: readArrayObjectChunks(
      propertyTail(source, "learningPath"),
      "modules",
    ).reduce(
      (count, module) =>
        count +
        readArrayObjectChunks(module, "units").filter((unit) =>
          Boolean(readStringProperty(unit, "title")),
        ).length,
      0,
    ),
  };
}

/** Reconstruct the planning card from durable snapshots, without storing tokens. */
export function goalPlanPreviewFromEvents(
  events: readonly { type: string; payload: Record<string, unknown> }[],
): { preview: GoalPlanStreamPreview; message: string } | undefined {
  let outline: Record<string, unknown> | undefined;
  let path: { moduleTitles: string[]; unitCount: number } | undefined;
  let message = "";
  for (const event of events) {
    const payload = event.payload;
    if (
      (event.type === "planning_stage" && payload.stage === "revising_plan") ||
      (event.type === "planning_activity" &&
        payload.id === "goal_identity" &&
        payload.status === "active" &&
        payload.elapsedSeconds === 0)
    ) {
      outline = undefined;
      path = undefined;
      message = "";
    }
    if (event.type === "planning_outline") outline = payload;
    const progress = payload.capabilityPath;
    if (
      event.type === "planning_activity" &&
      progress &&
      typeof progress === "object" &&
      "moduleTitles" in progress &&
      Array.isArray(progress.moduleTitles) &&
      "unitCount" in progress &&
      typeof progress.unitCount === "number"
    ) {
      path = {
        moduleTitles: progress.moduleTitles.filter(
          (title): title is string =>
            typeof title === "string" && Boolean(title.trim()),
        ),
        unitCount: Math.max(0, Math.floor(progress.unitCount)),
      };
      message = typeof payload.message === "string" ? payload.message : "";
    }
  }
  if (!outline && !path) return undefined;
  const modules = Array.isArray(outline?.modules)
    ? outline.modules.filter((module): module is Record<string, unknown> =>
        Boolean(module && typeof module === "object"),
      )
    : [];
  const titles =
    path?.moduleTitles ??
    modules.flatMap((module) =>
      typeof module.title === "string" ? [module.title] : [],
    );
  return {
    message,
    preview: {
      refinedTitle: "",
      field: typeof outline?.field === "string" ? outline.field : "",
      subdomain: "",
      learningMode: "",
      topicOverview:
        typeof outline?.topicOverview === "string" ? outline.topicOverview : "",
      outcomes: Array.isArray(outline?.whatYouWillLearn)
        ? outline.whatYouWillLearn.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
      modules: titles.map((title) => {
        const module = modules.find((entry) => entry.title === title);
        return {
          title,
          summary:
            typeof module?.objective === "string" ? module.objective : "",
        };
      }),
      unitCount:
        path?.unitCount ??
        modules.reduce(
          (count, module) =>
            count +
            (typeof module.estimatedUnitCount === "number"
              ? module.estimatedUnitCount
              : 0),
          0,
        ),
    },
  };
}

export function looksLikeGoalPlanStream(source: string): boolean {
  return (
    source.includes('"schemaVersion"') &&
    (source.includes('"domainAnalysis"') ||
      source.includes('"refinedTitle"') ||
      source.includes('"modules"'))
  );
}
