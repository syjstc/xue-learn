import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../../common/src/index.js";
import type {
  AssessmentTargetRepository,
  MaterialRegenerationRepository,
  UnitDeliveryReadRepository,
} from "../../../../../domain/src/index.js";
import { runWithUserId } from "../../../user-context.js";
import { runGenerationContextScope } from "../../../generation/kernel.js";
import { parseLearningMaterial } from "../../../graph/unit-session.js";
import { parseSessionGraphState } from "../../../graph/review-mode.js";
import {
  regenerateIllustrationBlock,
  replaceSvgBlockWithIllustration,
} from "../../../images/enrich-material.js";
import { resolveGoalContentLanguage } from "../../../llm/content-language.js";
import { compileComponentIntent } from "../../../llm/course-material-component-compiler.js";
import type { ComplexInteractiveBlockType } from "../../../llm/schemas.js";
import { compileTeachingDiagram } from "../../../llm/course-material-svg-generator.js";
import {
  COURSE_SVG_VISUAL_KINDS,
  parseCourseSvgIntentFromDescription,
  type CourseSvgIntent,
} from "../../../llm/course-svg-intent.js";
import {
  compileCourseMaterialInlineCheck,
  type InlineCheckPlan,
} from "../../../llm/course-material-inline-checks.js";
import { buildMaterialCheckTaskDeclarations } from "../../../assessment/index.js";
import { groupMaterialChecksAtSectionEnd } from "../../../sections/index.js";
import type { GenerateImageInput } from "../../../images/providers/types.js";
import { materialToJitItems } from "../../../llm/jit-structured-items.js";

type ImageRegenerationProgress =
  | Parameters<NonNullable<GenerateImageInput["onProgress"]>>[0]
  | { stage: "saving" };

type ParsedLearningMaterial = ReturnType<typeof parseLearningMaterial>;

function isDesktopDevSvgIllustrationReplaceEnabled(): boolean {
  return (
    process.env.XUELEARN_DESKTOP_LOCAL === "1" &&
    process.env.XUELEARN_DESKTOP_DEV === "1"
  );
}

const COMPLEX_RETRY_TYPES = new Set([
  "step_sort",
  "graph",
  "branch_scenario",
  "chart",
  "math_scene",
  "animated_svg",
  "svg",
  "interactive_html",
  "mechanics_sandbox",
  "circuit_sandbox",
  "param_simulator",
]);

function teachingDiagramIntentFromBlock(
  current: ParsedLearningMaterial["blocks"][number],
  description: string,
): CourseSvgIntent {
  if (current.type === "svg" && current.intent) {
    return current.intent;
  }
  const htmlVisualKind =
    current.type === "interactive_html" &&
    current.visualKind &&
    COURSE_SVG_VISUAL_KINDS.includes(current.visualKind)
      ? current.visualKind
      : null;
  const title =
    "title" in current && typeof current.title === "string"
      ? current.title
      : current.type === "svg" && typeof current.alt === "string"
        ? current.alt
        : description;
  const summary =
    "summary" in current && typeof current.summary === "string"
      ? current.summary
      : current.type === "svg" && typeof current.caption === "string"
        ? current.caption
        : current.type === "placeholder"
          ? (current.fallbackBody ?? description)
          : description;
  const fallback: CourseSvgIntent = {
    visualKind:
      htmlVisualKind ??
      (current.type === "animated_svg" &&
      Array.isArray(current.steps) &&
      current.steps.length > 1
        ? "step_derivation"
        : "simple_structure"),
    setup: description || title,
    learningGoal: title,
    expectedInsight: summary,
  };
  return parseCourseSvgIntentFromDescription(
    current.type === "placeholder"
      ? (current.description ?? description)
      : description,
    fallback,
  );
}

type RegenerationMaterialTarget = {
  material: ParsedLearningMaterial;
  localBlockIndex: number;
  sectionContext?: {
    id: string;
    contentRevision: number;
    title: string;
  };
};

/**
 * Resolve the learner-visible, unit-wide block index back to its authoritative
 * persisted material. First-class section material wins whenever a section
 * plan exists; LearningMaterial is only the legacy fallback used by the
 * section manifest when the unit has no sections.
 */
export async function resolveRegenerationMaterialTarget(
  repository: MaterialRegenerationRepository,
  userId: string,
  unitId: string,
  blockIndex: number,
): Promise<RegenerationMaterialTarget> {
  const source = await repository.findSource({ userId, unitId });
  if (!source) throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  const sections = source.sections;
  const hasSectionMaterial = sections.some((s) =>
    Boolean(s && s.generationStatus === "ready"),
  );
  if (hasSectionMaterial) {
    let offset = 0;
    for (const section of sections) {
      if (!section || section.generationStatus !== "ready") continue;
      const material = parseLearningMaterial({
        introduction: section.introduction,
        sections: section.blocks,
        keyTakeaways: section.keyTakeaways,
      });
      // Section reads group legacy inline checks at the end and can insert a
      // synthetic heading. Use that exact visible layout for global offsets,
      // then recover the original stored block by object identity.
      const visible = groupMaterialChecksAtSectionEnd(material);
      const visibleIndex = blockIndex - offset;
      if (visibleIndex >= 0 && visibleIndex < visible.blocks.length) {
        const storedIndex = material.blocks.indexOf(
          visible.blocks[visibleIndex],
        );
        if (storedIndex < 0) {
          throw new BadRequestException(
            tBackend("error.learning.componentMissing"),
          );
        }
        return {
          material,
          localBlockIndex: storedIndex,
          sectionContext: {
            id: section.id,
            contentRevision: section.contentRevision,
            title: section.title,
          },
        };
      }
      offset += visible.blocks.length;
    }
    throw new NotFoundException(tBackend("error.learning.materialNotFound"));
  }

  // A frozen section spine can be created before its section content is
  // authored. During that transition the learner may still be reading a
  // repaired legacy LearningMaterial row, so the presence of pending section
  // rows alone must not hide the material that supplied the visible block.
  const materialRow = source.legacy;
  if (!materialRow)
    throw new NotFoundException(tBackend("error.learning.materialNotFound"));
  return {
    material: parseLearningMaterial(materialRow),
    localBlockIndex: blockIndex,
  };
}

function replaceRegeneratedBlock(
  current: ParsedLearningMaterial["blocks"][number],
  replacement: ParsedLearningMaterial["blocks"][number],
  figureIndex?: number,
): ParsedLearningMaterial["blocks"][number] {
  if (figureIndex == null) return replacement;
  if (
    !Number.isInteger(figureIndex) ||
    figureIndex < 0 ||
    current?.type !== "stage" ||
    current.figures[figureIndex]?.type !== "illustration"
  ) {
    throw new BadRequestException(tBackend("error.learning.componentMissing"));
  }
  return {
    ...current,
    figures: current.figures.map((figure, index) =>
      index === figureIndex ? { ...figure, ...replacement } : figure,
    ),
  };
}

export async function regenerateIllustration(
  repository: MaterialRegenerationRepository,
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  blockIndex: number,
  onProgress?: (progress: ImageRegenerationProgress) => void | Promise<void>,
  prompt?: string,
  figureIndex?: number,
) {
  const [unit, content] = await Promise.all([
    unitRead.findPage({ userId, unitId }),
    unitRead.findContent({ userId, unitId }),
  ]);
  if (!unit || !content)
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));

  const target = await resolveRegenerationMaterialTarget(
    repository,
    userId,
    unitId,
    blockIndex,
  );
  const parent = target.material.blocks[target.localBlockIndex];
  if (figureIndex != null) {
    // Validate before calling the provider; the URL always addresses the parent block.
    replaceRegeneratedBlock(parent, parent, figureIndex);
  }
  const generationMaterial =
    figureIndex == null
      ? target.material
      : {
          ...target.material,
          blocks: target.material.blocks.map((block, index) =>
            index === target.localBlockIndex && block.type === "stage"
              ? block.figures[figureIndex]!
              : block,
          ),
        };
  const restoreStage = (
    updated: ParsedLearningMaterial,
    block: ParsedLearningMaterial["blocks"][number],
  ) => ({
    ...updated,
    blocks: updated.blocks.map((current, index) =>
      index === target.localBlockIndex
        ? replaceRegeneratedBlock(parent, block, figureIndex)
        : current,
    ),
  });
  const contentLanguage = resolveGoalContentLanguage(
    unit.contentLanguage,
    unit.goalTitle,
  );

  try {
    return await runWithUserId(userId, async () => {
      if (target.sectionContext) {
        const sectionContext = target.sectionContext;
        const { material: updated, block } = await regenerateIllustrationBlock(
          generationMaterial,
          unitId,
          target.localBlockIndex,
          {
            goalId: unit.goalId,
            unitTitle: `${unit.title} · ${sectionContext.title}`,
            contentLanguage,
          },
          { onProgress, prompt },
        );
        await onProgress?.({ stage: "saving" });
        const saved = await persistSectionBlockReplacement({
          repository,
          userId,
          unitId,
          blockIndex,
          sectionId: sectionContext.id,
          expectedSectionRevision: sectionContext.contentRevision,
          blocksJson: JSON.stringify(restoreStage(updated, block).blocks),
          replacement: block,
          figureIndex,
        });
        if (!saved.applied)
          throw new HttpException(
            tBackend("error.learning.contentUpdated"),
            HttpStatus.CONFLICT,
          );
        const contentRevision = saved.contentRevision;
        return {
          imageUrl: block.imageUrl,
          imageId: block.imageId,
          prompt: block.prompt,
          contentRevision,
          component: block,
        };
      }

      const material = generationMaterial;
      const { material: updated, block } = await regenerateIllustrationBlock(
        material,
        unitId,
        target.localBlockIndex,
        {
          goalId: unit.goalId,
          unitTitle: unit.title,
          contentLanguage,
        },
        { onProgress, prompt },
      );

      await onProgress?.({ stage: "saving" });
      const persisted = await persistLegacyBlockReplacement({
        repository,
        unitRead,
        userId,
        goalId: unit.goalId,
        unitId,
        blockIndex: target.localBlockIndex,
        replacement: block,
        figureIndex,
        fallbackBlocksJson: JSON.stringify(restoreStage(updated, block).blocks),
        expectedContentRevision: content.contentRevision,
        graphState: content.graphState,
      });
      if (!persisted.applied) {
        throw new HttpException(
          tBackend("error.learning.contentUpdated"),
          HttpStatus.CONFLICT,
        );
      }

      return {
        imageUrl: block.imageUrl,
        imageId: block.imageId,
        prompt: block.prompt,
        contentRevision: persisted.contentRevision,
        component: block,
      };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (
      message === "Block is not an illustration" ||
      message.startsWith("Image generation ") ||
      message.startsWith("Image provider ") ||
      message.startsWith("No image provider ")
    ) {
      throw new BadRequestException(
        tBackend("error.learning.imageRegenerationInvalid"),
      );
    }
    throw e;
  }
}

export async function replaceSvgWithIllustration(
  repository: MaterialRegenerationRepository,
  unitRead: UnitDeliveryReadRepository,
  userId: string,
  unitId: string,
  blockIndex: number,
  onProgress?: (progress: ImageRegenerationProgress) => void | Promise<void>,
) {
  if (!isDesktopDevSvgIllustrationReplaceEnabled()) {
    throw new ForbiddenException(
      tBackend("error.learning.svgIllustrationReplaceUnavailable"),
    );
  }

  const [unit, content] = await Promise.all([
    unitRead.findPage({ userId, unitId }),
    unitRead.findContent({ userId, unitId }),
  ]);
  if (!unit || !content)
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));

  const target = await resolveRegenerationMaterialTarget(
    repository,
    userId,
    unitId,
    blockIndex,
  );
  const contentLanguage = resolveGoalContentLanguage(
    unit.contentLanguage,
    unit.goalTitle,
  );

  try {
    return await runWithUserId(userId, async () => {
      if (target.sectionContext) {
        const sectionContext = target.sectionContext;
        const { material: updated, block } =
          await replaceSvgBlockWithIllustration(
            target.material,
            unitId,
            target.localBlockIndex,
            {
              goalId: unit.goalId,
              unitTitle: `${unit.title} · ${sectionContext.title}`,
              contentLanguage,
            },
            { onProgress },
          );
        await onProgress?.({ stage: "saving" });
        const saved = await persistSectionBlockReplacement({
          repository,
          userId,
          unitId,
          blockIndex,
          sectionId: sectionContext.id,
          expectedSectionRevision: sectionContext.contentRevision,
          blocksJson: JSON.stringify(updated.blocks),
          replacement: block,
        });
        if (!saved.applied)
          throw new HttpException(
            tBackend("error.learning.contentUpdated"),
            HttpStatus.CONFLICT,
          );
        return {
          component: block,
          imageUrl: block.imageUrl,
          imageId: block.imageId,
          contentRevision: saved.contentRevision,
        };
      }

      const { material: updated, block } =
        await replaceSvgBlockWithIllustration(
          target.material,
          unitId,
          target.localBlockIndex,
          {
            goalId: unit.goalId,
            unitTitle: unit.title,
            contentLanguage,
          },
          { onProgress },
        );

      await onProgress?.({ stage: "saving" });
      const persisted = await persistLegacyBlockReplacement({
        repository,
        unitRead,
        userId,
        goalId: unit.goalId,
        unitId,
        blockIndex: target.localBlockIndex,
        replacement: block,
        fallbackBlocksJson: JSON.stringify(updated.blocks),
        expectedContentRevision: content.contentRevision,
        graphState: content.graphState,
      });
      if (!persisted.applied) {
        throw new HttpException(
          tBackend("error.learning.contentUpdated"),
          HttpStatus.CONFLICT,
        );
      }

      return {
        component: block,
        imageUrl: block.imageUrl,
        imageId: block.imageId,
        contentRevision: persisted.contentRevision,
      };
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (
      message === "Block is not an svg diagram" ||
      message.startsWith("Image generation ") ||
      message.startsWith("Image provider ") ||
      message.startsWith("No image provider ")
    ) {
      throw new BadRequestException(
        tBackend("error.learning.imageRegenerationInvalid"),
      );
    }
    throw e;
  }
}

export async function regenerateComponent(
  repository: MaterialRegenerationRepository,
  unitRead: UnitDeliveryReadRepository,
  assessmentTarget: AssessmentTargetRepository,
  userId: string,
  unitId: string,
  blockIndex: number,
  placeholderComponentType?: string,
  onPartial?: (
    component: ParsedLearningMaterial["blocks"][number],
  ) => void | Promise<void>,
) {
  const [unit, content] = await Promise.all([
    unitRead.findPage({ userId, unitId }),
    unitRead.findContent({ userId, unitId }),
  ]);
  if (!unit || !content)
    throw new NotFoundException(tBackend("error.goal.unitNotFound"));
  const { material, localBlockIndex, sectionContext } =
    await resolveRegenerationMaterialTarget(
      repository,
      userId,
      unitId,
      blockIndex,
    );

  const current = material.blocks[localBlockIndex];
  if (!current) {
    throw new BadRequestException(tBackend("error.learning.componentMissing"));
  }
  // A regeneration can commit successfully while the learner's tab still has
  // the old placeholder (for example, a late session hydration overwrites the
  // optimistic local replacement). Treat that retry as a read-through sync:
  // return the already-persisted component instead of rejecting it or paying
  // for a duplicate model call. Param-simulator regeneration does not send
  // this placeholder precondition and therefore keeps its existing behavior.
  if (
    placeholderComponentType &&
    current.type !== "placeholder" &&
    current.type === placeholderComponentType
  ) {
    return {
      component: current,
      contentRevision: content.contentRevision,
    };
  }
  const placeholder = current.type === "placeholder" ? current : undefined;
  const upgradeSpatialMathSimulator =
    current.type === "param_simulator" &&
    /(?:向量|坐标|函数.{0,8}(?:图像|图象|曲线)|几何|vector|coordinate|function\s+(?:graph|curve)|geometry)/iu.test(
      `${current.title} ${current.formula}`,
    );
  const componentType =
    current.type === "param_simulator"
      ? upgradeSpatialMathSimulator
        ? "math_scene"
        : "param_simulator"
      : (placeholder?.componentType ??
        (COMPLEX_RETRY_TYPES.has(current.type) ? current.type : undefined));
  if (!componentType) {
    throw new BadRequestException(
      tBackend("error.learning.componentRegenerateForbidden"),
    );
  }
  const description =
    placeholder?.description ??
    (current.type === "param_simulator"
      ? upgradeSpatialMathSimulator
        ? `把“${current.title}”转换为统一的 math_scene 数学场景。保留教学目标，用可拖动端点、实时向量关系或函数参数呈现核心数学变化，不要再生成通用参数模拟器。`
        : `重新生成“${current.title}”。保留其教学目标，但修复无法计算的公式；公式只能引用 variables 中声明的 id，并确保每个输入变量实际参与计算。`
      : `重新生成这个交互组件，并确保所有字段和引用均有效。`);

  const contentLanguage = resolveGoalContentLanguage(
    unit.contentLanguage,
    unit.goalTitle,
  );
  let component: Awaited<ReturnType<typeof compileComponentIntent>>;
  let assessmentTargets: Awaited<
    ReturnType<AssessmentTargetRepository["findForUnit"]>
  > = [];
  const diagramTypes = new Set(["animated_svg", "interactive_html", "svg"]);
  if (componentType === "check") {
    if (
      !placeholder?.primaryLearningTargetId ||
      !placeholder.targetCognitiveEntityId ||
      !placeholder.evidenceDimension ||
      !placeholder.criterionRef
    ) {
      throw new BadRequestException(
        tBackend("error.learning.legacyCheckRegenerateUnsupported"),
      );
    }
    assessmentTargets = await assessmentTarget.findForUnit({ userId, unitId });
    const target = assessmentTargets.find(
      (candidate) =>
        candidate.localRef.toLowerCase() ===
        placeholder.primaryLearningTargetId?.toLowerCase(),
    );
    const criterion = target?.assessmentCriteria.find(
      (candidate) => candidate.ref === placeholder.criterionRef,
    );
    const requirement = target?.requirements.find(
      (candidate) =>
        candidate.cognitiveEntityId === placeholder.targetCognitiveEntityId &&
        candidate.dimension === placeholder.evidenceDimension,
    );
    if (!target || !criterion || !requirement) {
      throw new BadRequestException(
        tBackend("error.learning.materialCheckTargetsUpdated"),
      );
    }
    const plan: InlineCheckPlan = {
      slotRef: `regenerate_${blockIndex}`,
      questionType: "mcq",
      primaryLearningTargetId: target.localRef,
      targetCognitiveEntityId: requirement.cognitiveEntityId,
      evidenceDimension: placeholder.evidenceDimension,
      criterionRef: criterion.ref,
      contextDistance: "same",
      targetLabel: target.title,
      targetExplanation: target.description,
      learningObjective: target.learningObjective,
      assessmentCriterion: criterion.text,
      placementHint: `Replace material block ${blockIndex}.`,
    };
    component = await runGenerationContextScope(
      {
        subject: { userId, goalId: unit.goalId, unitId },
        query: `${unit.title}: regenerate material check`,
      },
      () =>
        runWithUserId(userId, () =>
          compileCourseMaterialInlineCheck({
            plan,
            unitTitle: sectionContext
              ? `${unit.title} · ${sectionContext.title}`
              : unit.title,
            language: contentLanguage,
            context: JSON.stringify({
              introduction: material.introduction,
              surroundingBlocks: material.blocks.slice(
                Math.max(0, localBlockIndex - 2),
                localBlockIndex + 3,
              ),
            }),
            meta: { unitId, blockIndex, regeneration: true },
          }),
        ),
    );
  } else if (diagramTypes.has(componentType)) {
    component = await runGenerationContextScope(
      {
        subject: { userId, goalId: unit.goalId, unitId },
        query: `${unit.title}: regenerate teaching diagram`,
      },
      () =>
        runWithUserId(userId, () =>
          compileTeachingDiagram({
            intent: teachingDiagramIntentFromBlock(current, description),
            unitTitle: sectionContext
              ? `${unit.title} · ${sectionContext.title}`
              : unit.title,
            language: contentLanguage,
            context: JSON.stringify({
              introduction: material.introduction,
              surroundingBlocks: material.blocks
                .slice(Math.max(0, localBlockIndex - 2), localBlockIndex + 3)
                .filter(
                  (_block, nearbyIndex) =>
                    Math.max(0, localBlockIndex - 2) + nearbyIndex !==
                    localBlockIndex,
                ),
            }),
            meta: { unitId, blockIndex, regeneration: true },
            onPartial,
          }),
        ),
    );
  } else {
    component = await runGenerationContextScope(
      {
        subject: { userId, goalId: unit.goalId, unitId },
        query: `${unit.title}: regenerate interactive component`,
      },
      () =>
        runWithUserId(userId, () =>
          compileComponentIntent({
            intent: {
              type: componentType as unknown as ComplexInteractiveBlockType,
              description,
            },
            unitTitle: sectionContext
              ? `${unit.title} · ${sectionContext.title}`
              : unit.title,
            language: contentLanguage,
            context: JSON.stringify({
              introduction: material.introduction,
              invalidComponent: current,
            }),
            meta: { unitId, blockIndex, regeneration: true },
            onPartial,
          }),
        ),
    );
  }
  if (
    !component ||
    (diagramTypes.has(componentType)
      ? component.type !== "animated_svg" &&
        component.type !== "interactive_html" &&
        component.type !== "svg"
      : component.type !== componentType)
  ) {
    throw new BadRequestException(
      tBackend("error.learning.componentRegenerateFailed"),
    );
  }

  const updated = {
    ...material,
    blocks: material.blocks.map((block, index) =>
      index === localBlockIndex ? component : block,
    ),
  };
  if (sectionContext) {
    const saved = await persistSectionBlockReplacement({
      repository,
      userId,
      unitId,
      blockIndex,
      sectionId: sectionContext.id,
      expectedSectionRevision: sectionContext.contentRevision,
      blocksJson: JSON.stringify(updated.blocks),
      replacement: component,
    });
    if (!saved.applied) {
      throw new HttpException(
        tBackend("error.learning.contentUpdated"),
        HttpStatus.CONFLICT,
      );
    }
    return { component, contentRevision: saved.contentRevision };
  }
  const tasks =
    componentType === "check"
      ? await buildMaterialCheckTaskDeclarations({
          userId,
          goalId: unit.goalId,
          unitId,
          material: updated,
          targets: assessmentTargets,
        })
      : [];
  const persisted = await persistLegacyBlockReplacement({
    repository,
    unitRead,
    userId,
    goalId: unit.goalId,
    unitId,
    blockIndex: localBlockIndex,
    replacement: component,
    fallbackBlocksJson: JSON.stringify(updated.blocks),
    expectedContentRevision: content.contentRevision,
    graphState: content.graphState,
    tasks,
  });
  if (!persisted.applied) {
    throw new HttpException(
      tBackend("error.learning.contentUpdated"),
      HttpStatus.CONFLICT,
    );
  }
  return { component, contentRevision: persisted.contentRevision };
}

export async function persistSectionBlockReplacement(params: {
  repository: MaterialRegenerationRepository;
  userId: string;
  unitId: string;
  blockIndex: number;
  sectionId: string;
  expectedSectionRevision: number;
  blocksJson: string;
  replacement: ParsedLearningMaterial["blocks"][number];
  figureIndex?: number;
  maxRetries?: number;
}) {
  const first = await params.repository.persistSectionBlocks({
    userId: params.userId,
    unitId: params.unitId,
    sectionId: params.sectionId,
    expectedSectionRevision: params.expectedSectionRevision,
    blocksJson: params.blocksJson,
  });
  if (first.applied) return first;

  // Image enrichment, parallel illustration replacements, or another in-place
  // patch can bump the section revision during the compile. Reload and write
  // the new block onto the current blocks instead of failing with a conflict.
  const maxRetries = params.maxRetries ?? 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const retried = await resolveRegenerationMaterialTarget(
      params.repository,
      params.userId,
      params.unitId,
      params.blockIndex,
    ).catch(() => null);
    if (!retried || retried.sectionContext?.id !== params.sectionId) {
      return first;
    }
    const merged = {
      ...retried.material,
      blocks: retried.material.blocks.map((block, index) =>
        index === retried.localBlockIndex
          ? replaceRegeneratedBlock(
              block,
              params.replacement,
              params.figureIndex,
            )
          : block,
      ),
    };
    const saved = await params.repository.persistSectionBlocks({
      userId: params.userId,
      unitId: params.unitId,
      sectionId: params.sectionId,
      expectedSectionRevision: retried.sectionContext.contentRevision,
      blocksJson: JSON.stringify(merged.blocks),
    });
    if (saved.applied) return saved;
  }

  return first;
}

export async function persistSectionBlockDeletion(params: {
  repository: MaterialRegenerationRepository;
  userId: string;
  unitId: string;
  blockIndex: number;
  sectionId: string;
  expectedSectionRevision: number;
  blocksJson: string;
  deletedBlockFingerprint: string;
  maxRetries?: number;
}) {
  const first = await params.repository.persistSectionBlocks({
    userId: params.userId,
    unitId: params.unitId,
    sectionId: params.sectionId,
    expectedSectionRevision: params.expectedSectionRevision,
    blocksJson: params.blocksJson,
  });
  if (first.applied) return first;

  const maxRetries = params.maxRetries ?? 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const retried = await resolveRegenerationMaterialTarget(
      params.repository,
      params.userId,
      params.unitId,
      params.blockIndex,
    ).catch(() => null);
    if (!retried || retried.sectionContext?.id !== params.sectionId) {
      return first;
    }
    const localIndex = retried.material.blocks.findIndex(
      (block) => JSON.stringify(block) === params.deletedBlockFingerprint,
    );
    if (localIndex < 0) return first;
    const merged = {
      ...retried.material,
      blocks: retried.material.blocks.filter(
        (_, index) => index !== localIndex,
      ),
    };
    const saved = await params.repository.persistSectionBlocks({
      userId: params.userId,
      unitId: params.unitId,
      sectionId: params.sectionId,
      expectedSectionRevision: retried.sectionContext.contentRevision,
      blocksJson: JSON.stringify(merged.blocks),
    });
    if (saved.applied) return saved;
  }

  return first;
}

export async function persistLegacyBlockReplacement(params: {
  repository: MaterialRegenerationRepository;
  unitRead: UnitDeliveryReadRepository;
  userId: string;
  goalId: string;
  unitId: string;
  blockIndex: number;
  replacement: ParsedLearningMaterial["blocks"][number];
  figureIndex?: number;
  fallbackBlocksJson: string;
  expectedContentRevision: number;
  graphState?: string | null;
  tasks?: readonly import("../../../../../domain/src/index.js").MaterialCheckTaskDefinition[];
  maxRetries?: number;
}) {
  const first = await params.repository.persistLegacyBlocks({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    expectedContentRevision: params.expectedContentRevision,
    blocksJson: params.fallbackBlocksJson,
    nextGraphStateJson: JSON.stringify({
      ...parseSessionGraphState(params.graphState ?? "{}"),
      materialSourceItems: materialToJitItems(
        parseLearningMaterial({
          sections: params.fallbackBlocksJson,
          introduction: "",
          keyTakeaways: "[]",
        }),
      ),
    }),
    tasks: params.tasks ?? [],
  });
  if (first.applied) return first;

  const maxRetries = params.maxRetries ?? 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const fresh = await params.unitRead
      .findContent({
        userId: params.userId,
        unitId: params.unitId,
      })
      .catch(() => null);
    if (!fresh || !fresh.learningMaterial) return first;
    const currentMaterial = parseLearningMaterial(fresh.learningMaterial);
    const merged = {
      ...currentMaterial,
      blocks: currentMaterial.blocks.map((block, index) =>
        index === params.blockIndex
          ? replaceRegeneratedBlock(
              block,
              params.replacement,
              params.figureIndex,
            )
          : block,
      ),
    };
    const saved = await params.repository.persistLegacyBlocks({
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      expectedContentRevision: fresh.contentRevision,
      blocksJson: JSON.stringify(merged.blocks),
      nextGraphStateJson: JSON.stringify({
        ...parseSessionGraphState(fresh.graphState ?? "{}"),
        materialSourceItems: materialToJitItems(merged),
      }),
      tasks: params.tasks ?? [],
    });
    if (saved.applied) return saved;
  }

  return first;
}

export async function persistLegacyBlockDeletion(params: {
  repository: MaterialRegenerationRepository;
  unitRead: UnitDeliveryReadRepository;
  userId: string;
  goalId: string;
  unitId: string;
  blockIndex: number;
  deletedBlockFingerprint: string;
  fallbackBlocksJson: string;
  expectedContentRevision: number;
  graphState?: string | null;
  maxRetries?: number;
}) {
  const nextGraphState = (blocksJson: string, graphState?: string | null) =>
    JSON.stringify({
      ...parseSessionGraphState(graphState ?? "{}"),
      materialSourceItems: materialToJitItems(
        parseLearningMaterial({
          sections: blocksJson,
          introduction: "",
          keyTakeaways: "[]",
        }),
      ),
    });
  const first = await params.repository.persistLegacyBlocks({
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    expectedContentRevision: params.expectedContentRevision,
    blocksJson: params.fallbackBlocksJson,
    nextGraphStateJson: nextGraphState(
      params.fallbackBlocksJson,
      params.graphState,
    ),
    tasks: [],
  });
  if (first.applied) return first;

  const maxRetries = params.maxRetries ?? 4;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const fresh = await params.unitRead
      .findContent({ userId: params.userId, unitId: params.unitId })
      .catch(() => null);
    if (!fresh || !fresh.learningMaterial) return first;
    const currentMaterial = parseLearningMaterial(fresh.learningMaterial);
    const localIndex = currentMaterial.blocks.findIndex(
      (block) => JSON.stringify(block) === params.deletedBlockFingerprint,
    );
    if (localIndex < 0) return first;
    const merged = {
      ...currentMaterial,
      blocks: currentMaterial.blocks.filter((_, index) => index !== localIndex),
    };
    const blocksJson = JSON.stringify(merged.blocks);
    const saved = await params.repository.persistLegacyBlocks({
      userId: params.userId,
      goalId: params.goalId,
      unitId: params.unitId,
      expectedContentRevision: fresh.contentRevision,
      blocksJson,
      nextGraphStateJson: nextGraphState(blocksJson, fresh.graphState),
      tasks: [],
    });
    if (saved.applied) return saved;
  }

  return first;
}
