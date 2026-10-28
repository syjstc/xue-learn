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
