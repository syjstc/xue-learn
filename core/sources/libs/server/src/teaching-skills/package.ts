import { createHash } from "node:crypto";
import {
  teachingSkillAdapterSchema,
  type TeachingSkillPackage,
  type TeachingSkillStage,
} from "./types.js";

const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_BYTES = 32 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const REQUIRED_SECTIONS = [
  "Map design",
  "Unit teaching",
  "Practice and evidence",
  "Adaptation",
] as const;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseFrontmatter(skillMd: string): {
  name: string;
  description: string;
  body: string;
} {
  const match = skillMd.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error("SKILL.md must start with YAML frontmatter");
  const values = new Map<string, string>();
  for (const line of match[1]!.split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!field) throw new Error(`Invalid SKILL.md frontmatter line: ${line}`);
    const key = field[1]!;
    if (key !== "name" && key !== "description") {
      throw new Error(
        "SKILL.md frontmatter may contain only name and description",
      );
    }
    const raw = field[2]!.trim();
    const value = raw.replace(/^(?:"([\s\S]*)"|'([\s\S]*)')$/, "$1$2");
    if (!value) throw new Error(`SKILL.md ${key} is required`);
    values.set(key, value);
  }
  if (values.size !== 2 || !values.get("name") || !values.get("description")) {
    throw new Error("SKILL.md requires name and description frontmatter");
  }
  return {
    name: values.get("name")!,
    description: values.get("description")!,
    body: match[2]!,
  };
}

function safePath(path: string): boolean {
  return (
    path === "SKILL.md" ||
    path === "xuelearn.json" ||
    (/^references\/[A-Za-z0-9._-]+$/.test(path) &&
      /\.(?:md|txt|json|ya?ml)$/i.test(path))
  );
}

/** Finder / Windows archive noise that must not be decoded as skill text. */
export function isIgnoredTeachingSkillZipPath(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.endsWith("/")) return true;
  const parts = normalized.split("/");
  return parts.some(
    (part) =>
      part === "__MACOSX" ||
      part === ".DS_Store" ||
      part === "Thumbs.db" ||
      part.startsWith("._"),
  );
}

/**
 * Convert an unzipped archive into package text files.
 * Skips macOS/Windows metadata, strips a single optional root folder,
 * and fail-closes on non-UTF-8 package files.
 */
export function readTeachingSkillZipEntries(
  archive: Record<string, Uint8Array>,
): Record<string, string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: Array<readonly [string, string]> = [];
  for (const [rawPath, content] of Object.entries(archive)) {
    const path = rawPath.replace(/\\/g, "/").replace(/^\.\//, "");
    if (isIgnoredTeachingSkillZipPath(path)) continue;
    try {
      entries.push([path, decoder.decode(content)]);
    } catch {
      throw new Error(`Skill package file is not valid UTF-8 text: ${path}`);
    }
  }
  if (entries.length === 0) {
    throw new Error("Skill package ZIP contains no text files");
  }
  const roots = new Set(entries.map(([path]) => path.split("/")[0]!));
  const stripRoot =
    roots.size === 1 && entries.every(([path]) => path.includes("/"));
  return Object.fromEntries(
    entries.map(([path, content]) => [
      stripRoot ? path.slice(path.indexOf("/") + 1) : path,
      content,
    ]),
  );
}

export function validateTeachingSkillPackage(
  input: Record<string, string>,
): TeachingSkillPackage {
  const entries = Object.entries(input);
  if (entries.length > 52) throw new Error("Skill package has too many files");
  if (!input["SKILL.md"] || !input["xuelearn.json"]) {
    throw new Error("Skill package requires SKILL.md and xuelearn.json");
  }
  let totalBytes = 0;
  for (const [path, content] of entries) {
    if (!safePath(path))
      throw new Error(`Unsupported skill package path: ${path}`);
    if (content.includes("\u0000"))
      throw new Error(`${path} is not UTF-8 text`);
    const size = byteLength(content);
    if (size > MAX_FILE_BYTES) throw new Error(`${path} exceeds 256 KiB`);
    totalBytes += size;
  }
  if (totalBytes > MAX_PACKAGE_BYTES)
    throw new Error("Skill package exceeds 2 MiB");
  if (byteLength(input["SKILL.md"]!) > MAX_SKILL_BYTES) {
    throw new Error("SKILL.md exceeds 32 KiB");
  }
  if (input["SKILL.md"]!.split(/\r?\n/).length > 500) {
    throw new Error("SKILL.md exceeds 500 lines");
  }

  const frontmatter = parseFrontmatter(input["SKILL.md"]!);
  for (const section of REQUIRED_SECTIONS) {
    if (!new RegExp(`^##\\s+${section}\\s*$`, "im").test(frontmatter.body)) {
      throw new Error(`SKILL.md is missing required section: ${section}`);
    }
  }
  let adapterValue: unknown;
  try {
    adapterValue = JSON.parse(input["xuelearn.json"]!);
  } catch {
    throw new Error("xuelearn.json must be valid JSON");
  }
  const adapter = teachingSkillAdapterSchema.parse(adapterValue);
  const declared = new Set(
    adapter.references.map((reference) => reference.path),
  );
  const actual = entries
    .map(([path]) => path)
    .filter((path) => path.startsWith("references/"));
  for (const path of declared) {
    if (!input[path]) throw new Error(`Missing declared reference: ${path}`);
  }
  for (const path of actual) {
    if (!declared.has(path))
      throw new Error(`Undeclared reference file: ${path}`);
  }
  const canonical = entries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => `${path}\0${content}`)
    .join("\0");
  return {
    skillMd: input["SKILL.md"]!,
    adapter,
    name: frontmatter.name,
    description: frontmatter.description,
    contentHash: createHash("sha256").update(canonical).digest("hex"),
    files: adapter.references.map((reference) => ({
      path: reference.path,
      content: input[reference.path]!,
      appliesTo: reference.appliesTo,
      keywords: reference.keywords,
    })),
  };
}

export function skillSectionsForStage(
  skillMd: string,
  stage: TeachingSkillStage,
): string {
  const { body } = parseFrontmatter(skillMd);
  const sections = new Map<string, string>();
  const headings = Array.from(body.matchAll(/^##\s+(.+?)\s*$/gm));
  headings.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = headings[index + 1]?.index ?? body.length;
    sections.set(match[1]!.trim(), body.slice(start, end).trim());
  });
  const wanted =
    stage === "goal_plan" || stage === "module_units"
      ? ["Map design", "Practice and evidence", "Adaptation"]
      : stage === "scenario_theater"
        ? ["Scenario theater", "Practice and evidence", "Adaptation"]
        : ["Unit teaching", "Practice and evidence", "Adaptation"];
  return wanted
    .flatMap((heading) => {
      const value = sections.get(heading);
      return value ? [`## ${heading}\n${value}`] : [];
    })
    .join("\n\n");
}
