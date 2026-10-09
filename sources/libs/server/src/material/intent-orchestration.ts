import type {
  ComplexInteractiveBlockType,
  InteractiveBlock,
} from "../llm/schemas.js";
import type {
  SectionMaterialAuthoringPolicy,
  SectionMaterialAuthoringResult,
} from "./authoring.js";
import {
  formatCourseSvgIntent,
  type CourseSvgIntent,
} from "../llm/course-svg-intent.js";
import { rewriteInLessonVisualWireItemToIllustration } from "../llm/illustration-from-visual-intent.js";

type MaterialIntent = Omit<CourseSvgIntent, "visualKind"> & {
  visualKind?: CourseSvgIntent["visualKind"];
};

export function componentCompilationFallback(
  componentType: ComplexInteractiveBlockType,
  body: string,
): InteractiveBlock {
  return {
    type: "placeholder",
    reason: "interactive component compilation failed",
    componentType,
    description: body,
    fallbackBody: body,
  };
}

export function svgCompilationFallback(
  intent: MaterialIntent & {
    visualKind?:
      | "simple_structure"
      | "spatial_relationship"
      | "state_comparison"
      | "step_derivation";
  },
): InteractiveBlock {
  const visualKind = intent.visualKind ?? "simple_structure";
  return {
    type: "placeholder",
    reason: "teaching diagram compilation failed",
    componentType: "svg",
    description: formatCourseSvgIntent({
      ...intent,
      visualKind,
    }),
    fallbackBody: intent.expectedInsight,
  };
}

export type ResolvedSectionMaterial = {
  introduction: string;
  blocks: InteractiveBlock[];
  keyTakeaways: string[];
};

/**
 * Resolve optional material display intents without changing their authored
 * positions. Compiler failures are localized using the hosted static fallback
 * policy; authoring/schema failures remain fail-closed before this boundary.
 */
export async function resolveSectionMaterialIntents(input: {
  material: SectionMaterialAuthoringResult;
  policy: SectionMaterialAuthoringPolicy;
  unitTitle: string;
  language: string;
  authoritativeSectionContext: string;
  compileComponent: (input: {
    intent: { type: ComplexInteractiveBlockType; description: string };
    unitTitle: string;
    language: string;
    context: string;
  }) => Promise<InteractiveBlock>;
  compileSvg: (input: {
    intent: MaterialIntent & {
      visualKind:
        | "simple_structure"
        | "spatial_relationship"
        | "state_comparison"
        | "step_derivation";
    };
    unitTitle: string;
    language: string;
    context: string;
  }) => Promise<InteractiveBlock>;
}): Promise<{ material: ResolvedSectionMaterial; fallbackCount: number }> {
  const plannedTypes = new Map(
    (input.policy.plannedComponents ?? []).map((component) => [
      component.id,
      component.componentType,
    ]),
  );
  let fallbackCount = 0;
  const blocks = await Promise.all(
    input.material.blocks.map(
      async (block, index): Promise<InteractiveBlock> => {
        if (input.policy.replaceInLessonVisualsWithIllustrations) {
          const rewritten = rewriteInLessonVisualWireItemToIllustration(block);
          if (
            rewritten &&
            typeof rewritten === "object" &&
            !Array.isArray(rewritten) &&
            (rewritten as { type?: string }).type === "illustration"
          ) {
            return rewritten as InteractiveBlock;
          }
        }
        if (block.type !== "component_slot" && block.type !== "svg_slot") {
          return block as InteractiveBlock;
        }
        const nearby = JSON.stringify(
          input.material.blocks.slice(Math.max(0, index - 4), index + 3),
        ).slice(0, 6_000);
        if (block.type === "svg_slot") {
          const context = `${input.authoritativeSectionContext}\n\nLesson-local SVG intent:\n${formatCourseSvgIntent(block.intent as CourseSvgIntent)}\n\nNearby authored lesson blocks (slot position is authoritative):\n${nearby}`;
          try {
            return await input.compileSvg({
              intent: block.intent,
              unitTitle: input.unitTitle,
              language: input.language,
              context,
            });
          } catch {
            fallbackCount += 1;
            return svgCompilationFallback(block.intent);
          }
        }
        const slotRef = "slotRef" in block ? block.slotRef : undefined;
        const componentType =
          "componentType" in block
            ? block.componentType
            : slotRef
              ? plannedTypes.get(slotRef)
              : undefined;
        if (!componentType) {
          throw new Error(
            `Missing frozen component type for ${slotRef ?? "unknown slot"}`,
          );
        }
        const description = `${block.intent.setup}\nLearning goal: ${block.intent.learningGoal}\nExpected insight: ${block.intent.expectedInsight}`;
        const context = `${input.authoritativeSectionContext}\n\nLesson-local component intent:\n${description}\n\nNearby authored lesson blocks (slot position is authoritative):\n${nearby}`;
        try {
          return await input.compileComponent({
            intent: { type: componentType, description },
            unitTitle: input.unitTitle,
            language: input.language,
            context,
          });
        } catch {
          fallbackCount += 1;
          return componentCompilationFallback(componentType, description);
        }
      },
    ),
  );
  return {
    material: {
      introduction: input.material.introduction,
      blocks,
      keyTakeaways: input.material.keyTakeaways,
    },
    fallbackCount,
  };
}
