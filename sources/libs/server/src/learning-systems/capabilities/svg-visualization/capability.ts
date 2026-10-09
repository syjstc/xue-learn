import { z } from "zod";
import { defineAgentTool } from "../../../agents/core/tools.js";
import { capabilityToolSetFromTools } from "../../../agents/core/tool-capability.js";
import { interactiveHtmlSchema } from "../../../llm/schemas.js";
import {
  compileTeachingDiagram,
  courseSvgBlockSchema,
} from "../../../llm/course-material-svg-generator.js";
import { defineLearningSystemCapability } from "../../define-capability.js";

export const SVG_VISUALIZATION_CAPABILITY_ID = "svg-visualization" as const;
export const SVG_VISUALIZATION_CAPABILITY_VERSION = "1.0.0" as const;
export const SVG_VISUALIZATION_TOOL_SET = "svg.visualization" as const;
const SVG_TOOL_STATE_KEY = "__svgVisualizationBlock";

const drawTeachingDiagramArgsSchema = z.object({
  visualKind: z.enum([
    "simple_structure",
    "spatial_relationship",
    "state_comparison",
    "step_derivation",
  ]),
  title: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(80),
  setup: z.string().trim().min(2).max(1_000),
  learningGoal: z.string().trim().min(2).max(1_000),
  expectedInsight: z.string().trim().min(2).max(1_000),
  context: z.string().trim().min(2).max(6_000),
});

export function createSvgVisualizationCapability() {
  const drawTeachingDiagram = defineAgentTool({
    name: "draw_teaching_diagram",
    description:
      "Generate one validated teaching diagram just in time when a schematic, spatial relationship, state comparison, or short step derivation materially helps the learner and no specialized teaching component is a better fit. Supply only facts already established in the conversation or learning context. Do not use for people, anatomy, animals, realistic/organic subjects, measured charts, mathematical plots, complex graphs, processes, hierarchies, labs, or decorative images.",
    schema: drawTeachingDiagramArgsSchema,
    handler: async (args, ctx) => {
      const block = await compileTeachingDiagram({
        unitTitle: args.title,
        language: args.language,
        context: args.context,
        intent: {
          visualKind: args.visualKind,
          setup: args.setup,
          learningGoal: args.learningGoal,
          expectedInsight: args.expectedInsight,
        },
        signal: ctx.signal,
        meta: {
          source: "agent_tool",
          threadId: ctx.threadId,
        },
      });
      if (!block) {
        throw new Error("This subject is not eligible for a safe SVG diagram");
      }
      const parsed = interactiveHtmlSchema.safeParse(block).success
        ? interactiveHtmlSchema.parse(block)
        : courseSvgBlockSchema.parse(block);
      // Keep executable diagram data out of the model-visible tool result.
      ctx.state[SVG_TOOL_STATE_KEY] = parsed;
      return {
        drawn: true,
        title: parsed.title,
        caption:
          "summary" in parsed ? parsed.summary : parsed.caption,
      };
    },
    renderUi: (_args, _result, ctx) => {
      const html = interactiveHtmlSchema.safeParse(
        ctx.state[SVG_TOOL_STATE_KEY],
      );
      const markup = courseSvgBlockSchema.safeParse(
        ctx.state[SVG_TOOL_STATE_KEY],
      );
      delete ctx.state[SVG_TOOL_STATE_KEY];
      if (html.success) {
        return { uiKind: "svg_diagram", args: { block: html.data } };
      }
      if (markup.success) {
        return { uiKind: "svg_diagram", args: { block: markup.data } };
      }
      return null;
    },
  });

  return defineLearningSystemCapability({
    id: SVG_VISUALIZATION_CAPABILITY_ID,
    version: SVG_VISUALIZATION_CAPABILITY_VERSION,
    kind: "tool_provider",
    toolSets: [
      capabilityToolSetFromTools({
        key: SVG_VISUALIZATION_TOOL_SET,
        ownerCapabilityId: SVG_VISUALIZATION_CAPABILITY_ID,
        ownerCapabilityVersion: SVG_VISUALIZATION_CAPABILITY_VERSION,
        description:
          "Just-in-time safe SVG teaching diagrams for simple structures, spatial relationships, and state comparisons.",
        requiredScopes: ["user"],
        tools: [drawTeachingDiagram],
      }),
    ],
  });
}
