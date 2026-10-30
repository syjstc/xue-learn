import type { UnitSectionManifest } from "@/shared/api";
import type { Step, StructuredTab } from "../unit-wizard/types.ts";

export type UnitJourneyNodeStatus =
  "completed" | "current" | "available" | "locked";

export type UnitJourneyNode = {
  id: string;
  label?: string;
  kind:
    "preview" | "section" | "questions" | "recall" | "correction" | "complete";
  status: UnitJourneyNodeStatus;
  sectionId?: string;
};

export type UnitJourneyReference = {
  id: Extract<StructuredTab, "map" | "notes">;
  available: boolean;
};

/** Optional learning activities sit outside the required GELC sequence. */
export type UnitJourneyActivity = {
  id: "theater" | "lab";
  available: boolean;
};

const STEP_ORDER: Step[] = [
  "structured_input",
  "active_recall",
  "feynman",
  "socratic",
  "complete",
];

function isFinished(status: UnitSectionManifest["status"]) {
  return status === "completed" || status === "skipped";
}

export function buildUnitJourney(input: {
  step: Step;
  structuredTab: StructuredTab;
  sections: UnitSectionManifest[];
  selectedSectionId?: string | null;
  hasSq: boolean;
  hasMaterial: boolean;
  hasKacom?: boolean;
  hasSocratic: boolean;
  isLearningDone: boolean;
  orientationOnly?: boolean;
  readingBody?: boolean;
}): {
  nodes: UnitJourneyNode[];
  references: UnitJourneyReference[];
  currentId: string;
} {
  const stepIndex = STEP_ORDER.indexOf(input.step);
  const inStructured = input.step === "structured_input";
  const currentSection =
    input.sections.find((section) => section.id === input.selectedSectionId) ??
    input.sections.find((section) => !isFinished(section.status)) ??
    input.sections.at(-1);
  const previewCompleted =
    !inStructured ||
    input.hasMaterial ||
    input.sections.some((section) => isFinished(section.status));
  const previewCurrent = inStructured && input.structuredTab === "sq";
  const nodes: UnitJourneyNode[] = input.orientationOnly
    ? []
    : [
        {
          id: "preview",
          kind: "preview",
          status: previewCurrent
            ? "current"
            : previewCompleted
              ? "completed"
              : "available",
        },
      ];

  const orderedSections = input.sections
    .filter((section) => !section.legacy)
    .sort((left, right) => left.orderIndex - right.orderIndex);
  const contentTitleCounts = new Map<string, number>();
  orderedSections.forEach((section) => {
    if (section.sectionKind !== "content") return;
    const title = section.title.trim();
    contentTitleCounts.set(title, (contentTitleCounts.get(title) ?? 0) + 1);
  });
  let contentNumber = 0;

  orderedSections.forEach((section, index) => {
    if (section.sectionKind === "content") contentNumber += 1;
    const sectionNumber = Math.max(1, contentNumber);
    const normalizedTitle = section.title.trim();
    const repeatedContentTitle =
      section.sectionKind === "content" &&
      (contentTitleCounts.get(normalizedTitle) ?? 0) > 1;
    const label =
      section.sectionKind === "mini_test"
        ? normalizedTitle
        : repeatedContentTitle
          ? `第 ${sectionNumber} 节 · 学习内容`
          : `第 ${sectionNumber} 节 · ${normalizedTitle}`;
    const priorDone = orderedSections
      .slice(0, index)
      .every((candidate) => isFinished(candidate.status));
    const current =
      inStructured &&
      input.structuredTab === "material" &&
      currentSection?.id === section.id;
    nodes.push({
      id: `section:${section.id}`,
      sectionId: section.id,
      kind: "section",
      label,
      status: current
        ? "current"
        : isFinished(section.status)
          ? "completed"
          : priorDone && (input.readingBody && section.sectionKind === "content" || section.generationStatus !== "failed")
            ? "available"
            : "locked",
    });
  });

  const structuredComplete =
    !inStructured ||
    (input.sections.length > 0 &&
      input.sections.every(
        (section) => section.legacy || isFinished(section.status),
      ));
  if (!input.orientationOnly) {
    const questionsCompleted = !inStructured || input.structuredTab === "notes";
    nodes.push({
      id: "questions",
      kind: "questions",
      status:
        inStructured && input.structuredTab === "questions"
          ? "current"
          : questionsCompleted
            ? "completed"
            : structuredComplete && input.hasSq && input.hasMaterial
              ? "available"
              : "locked",
    });
    nodes.push({
      id: "recall",
      kind: "recall",
      status:
        input.step === "active_recall"
          ? "current"
          : stepIndex > STEP_ORDER.indexOf("active_recall")
            ? "completed"
            : structuredComplete && questionsCompleted
              ? "available"
              : "locked",
    });
    if (input.hasSocratic || input.step === "socratic") {
      nodes.push({
        id: "correction",
        kind: "correction",
        status:
          input.step === "socratic"
            ? "current"
            : stepIndex > STEP_ORDER.indexOf("socratic")
              ? "completed"
              : input.hasSocratic
                ? "available"
                : "locked",
      });
    }
  }
  nodes.push({
    id: "complete",
    kind: "complete",
    status:
      input.step === "complete"
        ? "current"
        : input.isLearningDone
          ? "completed"
          : "locked",
  });

  const currentId =
    nodes.find((node) => node.status === "current")?.id ??
    nodes.find((node) => node.status === "available")?.id ??
    "preview";
  return {
    nodes,
    currentId,
    references: [
      ...(input.hasKacom === false || input.orientationOnly
        ? []
        : [{ id: "map" as const, available: input.hasMaterial }]),
      ...(input.orientationOnly
        ? []
        : [{ id: "notes" as const, available: input.hasMaterial }]),
    ],
  };
}
