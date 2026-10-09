import { requireGoalTextbookPersistence } from "./goal-textbook-persistence.js";
import { getAggregatedUnitMaterial } from "../sections/index.js";
import { parseMapPlan } from "../goals/map-plan.js";
import type { GoalMapPlan, LearningMaterialContent, SqPreview } from "../llm/schemas.js";
import {
  buildUnitTree,
  formatTreeIndex,
  type UnitTreeNode,
} from "../domain/unit-tree-build.js";
import { parseJson } from "../utils.js";

export type TextbookCornell = {
  notes: string;
  cues: string;
  summary: string;
};

export type TextbookModuleSection = {
  kind: "module";
  index: string;
  title: string;
  contentSummary: string;
};

export type TextbookLessonSection = {
  kind: "lesson";
  unitId: string;
  index: string;
  title: string;
  contentSummary: string;
  status: string;
  sq: SqPreview | null;
  material: LearningMaterialContent | null;
  cornell: TextbookCornell | null;
};

export type TextbookSection = TextbookModuleSection | TextbookLessonSection;

export type GoalTextbook = {
  goal: {
    id: string;
    title: string;
    level: string;
    topicOverview: string;
    createdAt: Date;
  };
  mapPlan: GoalMapPlan | null;
  sections: TextbookSection[];
  stats: {
    totalUnits: number;
    lessonCount: number;
    moduleCount: number;
    lessonsWithMaterial: number;
  };
};

function parseSqData(raw: string): SqPreview | null {
  const data = parseJson<Record<string, unknown>>(raw, {});
  if (!data.survey || !data.questions) return null;
  return data as SqPreview;
}

type UnitWithContent = {
  id: string;
  title: string;
  unitKind: string;
  parentUnitId: string | null;
  orderIndex: number;
  contentSummary: string;
  status: string;
  aggregatedMaterial: LearningMaterialContent | null;
  learningMaterial: {
    introduction: string;
    sections: string;
    keyTakeaways: string;
  } | null;
  cornellNote: {
    notes: string;
    cues: string;
    summary: string;
  } | null;
  sessionState: { sq3rData: string } | null;
};

function walkTree(
  nodes: UnitTreeNode[],
  parentIndices: number[],
  byId: Map<string, UnitWithContent>,
  out: TextbookSection[]
) {
  nodes.forEach((node, i) => {
    const indices = [...parentIndices, i + 1];
    const index = formatTreeIndex(indices);
    const row = byId.get(node.id);
    if (!row) return;

    if (node.unitKind === "module") {
      out.push({
        kind: "module",
        index,
        title: row.title,
        contentSummary: row.contentSummary.trim(),
      });
      walkTree(node.children, indices, byId, out);
      return;
    }

    const material = row.aggregatedMaterial;
    const sq = row.sessionState
      ? parseSqData(row.sessionState.sq3rData)
      : null;
    const cornell = row.cornellNote
      ? {
          notes: row.cornellNote.notes,
          cues: row.cornellNote.cues,
          summary: row.cornellNote.summary,
        }
      : null;

    out.push({
      kind: "lesson",
      unitId: row.id,
      index,
      title: row.title,
      contentSummary: row.contentSummary.trim(),
      status: row.status,
      sq,
      material,
      cornell,
    });

    if (node.children.length > 0) {
      walkTree(node.children, indices, byId, out);
    }
  });
}

export async function loadGoalTextbook(goalId: string): Promise<GoalTextbook | null> {
  const goal = await requireGoalTextbookPersistence().find(goalId);
  if (!goal) return null;

  const unitsWithMaterial = await Promise.all(
    goal.units.map(async (unit) => ({
      ...unit,
      learningMaterial: null,
      cornellNote: unit.cornell,
      sessionState: unit.sq3rData ? { sq3rData: unit.sq3rData } : null,
      aggregatedMaterial:
        unit.unitKind === "lesson"
          ? await getAggregatedUnitMaterial(unit.id)
          : null,
    })),
  );
  const byId = new Map(unitsWithMaterial.map((u) => [u.id, u]));
  const tree = buildUnitTree(
    goal.units.map((u) => ({
      id: u.id,
      title: u.title,
      status: u.status,
      unitKind: u.unitKind,
      parentUnitId: u.parentUnitId,
      orderIndex: u.orderIndex,
    }))
  );

  const sections: TextbookSection[] = [];
  walkTree(tree, [], byId, sections);

  const lessons = sections.filter((s) => s.kind === "lesson") as TextbookLessonSection[];
  const modules = sections.filter((s) => s.kind === "module");

  return {
    goal: {
      id: goal.id,
      title: goal.title,
      level: goal.level,
      topicOverview: goal.topicOverview.trim(),
      createdAt: goal.createdAt,
    },
    mapPlan: parseMapPlan(goal.mapPlanJson),
    sections,
    stats: {
      totalUnits: goal.units.length,
      lessonCount: lessons.length,
      moduleCount: modules.length,
      lessonsWithMaterial: lessons.filter((l) => l.material).length,
    },
  };
}

export function textbookDownloadFilename(title: string): string {
  const base = title
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  return `${base || "learning-goal"}-textbook.pdf`;
}
