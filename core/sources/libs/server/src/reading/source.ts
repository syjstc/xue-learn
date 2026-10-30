import type { CourseSourceSnapshotV1 } from "../../../runtime-contracts/src/course-source.js";
import type { ReadingComponentArtifact } from "../../../domain/src/reading-document.js";
import { parseTeachingDerivationDocument } from "../../../teaching-derivation/src/index.js";
import { teachingDerivationToReading } from "../../../teaching-derivation/src/reading.js";
import type { ReadingSource, ReadingSectionSource } from "./workspace.js";

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const proseKeys = new Set(["title", "text", "body", "caption", "summary", "description", "question",
  "explanation", "label", "justification", "latex", "introduction", "keyTakeaways"]);
const skipKeys = new Set(["derived", "teachingDerivationDerived", "targets", "timeline", "presentation",
  "transitions", "build", "cues", "intents", "lineageBackup", "presentationBackup", "svg", "imageUrl"]);

export function readingReferenceText(value: unknown): string {
  const texts: string[] = [];
  const walk = (item: unknown, key = "") => {
    if (typeof item === "string") { if (proseKeys.has(key) && item.trim()) texts.push(item); return; }
    if (Array.isArray(item)) { item.forEach(child => walk(child, key)); return; }
    for (const [name, child] of Object.entries(record(item))) if (!skipKeys.has(name)) walk(child, name);
  };
  walk(value);
  return [...new Set(texts)].join("\n\n");
}

/** Accepts the database's read-only projection, with no ready-Display or asset-export gate. */
export function readingSourceFromCourse(
  course: Pick<CourseSourceSnapshotV1, "source" | "metadata" | "sections" | "legacyMaterial">,
): ReadingSource {
  const build = (section: {id: string; title: string; scope: string; material: unknown; teachingDerivationDocument: unknown; derivationDocument?: unknown}): ReadingSectionSource => {
    const artifacts: Record<string, ReadingComponentArtifact> = {};
    const addDerivation = (value: unknown) => {
      const document = parseTeachingDerivationDocument(value);
      if (document?.steps.length)
        artifacts[`source_${Object.keys(artifacts).length + 1}`] = {type: "derivation", document: teachingDerivationToReading(document)};
    };
    const scan = (value: unknown) => {
      if (Array.isArray(value)) {value.forEach(scan); return;}
      const node = record(value), payload = record(node.payload);
      if (node.kind === "math:derivation") {addDerivation(payload.document); return;}
      if (node.type === "svg" && typeof node.svg === "string")
        artifacts[`source_${Object.keys(artifacts).length + 1}`] = {
          type: "svg", svg: node.svg, caption: String(node.caption ?? ""), alt: String(node.alt ?? node.title ?? ""),
        };
      if (node.type === "illustration" && typeof node.imageUrl === "string")
        artifacts[`source_${Object.keys(artifacts).length + 1}`] = {
          type: "image", imageUrl: node.imageUrl, caption: String(node.caption ?? ""),
        };
      for (const [key, child] of Object.entries(node)) if (!skipKeys.has(key)) scan(child);
    };
    addDerivation(section.teachingDerivationDocument);
    scan(section.material);
    return {
      id: section.id, title: section.title, scope: section.scope,
      reference: readingReferenceText([section.material, section.teachingDerivationDocument, section.derivationDocument]), artifacts,
    };
  };
  const sections = course.sections.length ? course.sections.map(build) : [build({
    id: course.source.unitId, title: course.metadata.title, scope: course.metadata.scope,
    material: course.legacyMaterial ? {
      introduction: course.legacyMaterial.introduction, blocks: course.legacyMaterial.sections,
      keyTakeaways: course.legacyMaterial.keyTakeaways,
    } : null, teachingDerivationDocument: null,
  })];
  return {unitId: course.source.unitId, goalId: course.source.goalId, title: course.metadata.title,
    language: course.metadata.contentLanguage || "zh-Hans", sections};
}
