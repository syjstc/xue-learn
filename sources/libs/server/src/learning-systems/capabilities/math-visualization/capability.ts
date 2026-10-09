import { defineAgentTool } from "../../../agents/core/tools.js";
import { capabilityToolSetFromTools } from "../../../agents/core/tool-capability.js";
import { mathSceneBindingSchema, mathSceneSchema } from "../../../llm/schemas.js";
import { defineLearningSystemCapability } from "../../define-capability.js";

export const MATH_VISUALIZATION_CAPABILITY_ID = "math-visualization" as const;
export const MATH_VISUALIZATION_CAPABILITY_VERSION = "1.0.0" as const;
export const MATH_VISUALIZATION_TOOL_SET = "math.visualization" as const;

const drawMathSceneArgsSchema = mathSceneBindingSchema.superRefine(
  (args, ctx) => {
    const parsed = mathSceneSchema.safeParse(args);
    if (parsed.success) return;
    parsed.error.issues.forEach((issue) =>
      ctx.addIssue({
        code: "custom",
        path: issue.path[0] === "type" ? issue.path.slice(1) : issue.path,
        message: issue.message,
      }),
    );
  },
);

export function createMathVisualizationCapability() {
  const drawMathScene = defineAgentTool({
    name: "draw_math_scene",
    description:
      "Draw a validated 2D or 3D mathematical coordinate scene when seeing the spatial relationship materially helps the learner. Supports points, vectors, segments, functions, parametric/polar curves, and surfaces. Keep every explicit coordinate inside the declared ranges with margin; use distinct colors and labels for overlapping vectors. Use this instead of emitting SVG, code, Mermaid, or renderer configuration.",
    schema: drawMathSceneArgsSchema,
    handler: async (args) => mathSceneSchema.parse(args),
    renderUi: (_args, result) => {
      const scene = mathSceneSchema.safeParse(result);
      return scene.success
        ? { uiKind: "math_scene", args: { scene: scene.data } }
        : null;
    },
  });

  return defineLearningSystemCapability({
    id: MATH_VISUALIZATION_CAPABILITY_ID,
    version: MATH_VISUALIZATION_CAPABILITY_VERSION,
    kind: "tool_provider",
    toolSets: [
      capabilityToolSetFromTools({
        key: MATH_VISUALIZATION_TOOL_SET,
        ownerCapabilityId: MATH_VISUALIZATION_CAPABILITY_ID,
        ownerCapabilityVersion: MATH_VISUALIZATION_CAPABILITY_VERSION,
        description:
          "Validated mathematical diagrams: 2D functions and geometry, polar/parametric curves, vectors, and 3D curves or surfaces.",
        requiredScopes: ["user"],
        tools: [drawMathScene],
      }),
    ],
  });
}
