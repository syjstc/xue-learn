import { z } from "zod";
import type { MathScene } from "../../../domain/src/index.js";
import { hasProviderCredentials } from "../env.js";
import {
  withExplicitLlmSelection,
  withLlmOperationRoute,
} from "../providers/llm/index.js";
import { runValidatedStructuredGeneration } from "./validated-structured-generation.js";

export const COURSE_MATH_SCENE_AUDIT_MODEL = "deepseek-flash";

export const courseMathSceneAuditSchema = z.object({
  result: z.boolean(),
  reason: z.string().optional(),
});

export type CourseMathSceneAudit = z.infer<typeof courseMathSceneAuditSchema>;

/**
 * This prefix is deliberately invariant. Lesson facts and scene JSON are
 * appended below it so repeated audits can reuse the provider prefix cache.
 */
export const COURSE_MATH_SCENE_AUDIT_PROMPT = `You are a rigorous mathematical teaching-scene auditor. Audit an already compiled declarative math scene; do not author a replacement scene.

Check semantic truth before presentation:
1. Derive the important mathematical claims from the teaching requirement, title, labels, and summary. Verify that the actual expressions, coordinates, domains, parameters, vector relations, and plotted limits support those claims.
2. Check intersections, roots, extrema, monotonicity, asymptotes and limits, signs, ordering, geometry, vector arithmetic, parameter behavior, and dimensional or coordinate-system consistency whenever relevant. Inspect the whole declared domain and meaningful parameter range, not just one convenient sample.
3. Text is not evidence. A correct title, label, reference line, or summary cannot compensate for a curve or object that depicts a contradictory relationship.
4. Distinguish an exact finite equality from asymptotic convergence. Do not accept curves that merely cross once when the requirement says they approach and remain at a common equilibrium.
5. Check that every visible label identifies the correct object and that the chosen ranges do not hide a contradiction or materially clip the teaching relationship.
6. Do not reject a mathematically correct scene for optional style changes.

Return {"result":true} with no reason only when the complete scene is mathematically consistent with the teaching requirement and its own learner-visible claims. Otherwise return result=false and a concise repair contract in reason. The contract must state: (a) the false claim, (b) the scene fields or expressions causing it, (c) the required mathematical relationship, and (d) an objectively testable acceptance condition. Preserve correct parts explicitly when useful.`;

export function buildCourseMathSceneAuditPrompt(params: {
  scene: MathScene;
  teachingBrief: string;
}): string {
  return `${COURSE_MATH_SCENE_AUDIT_PROMPT}\n\nTeaching requirement (the content authority):\n${params.teachingBrief
    .trim()
    .slice(
      0,
      6_000,
    )}\n\nCompiled math_scene JSON (the artifact to audit):\n${JSON.stringify(params.scene)}`;
}

export async function auditCourseMathSceneIfConfigured(params: {
  scene: MathScene;
  teachingBrief: string;
  signal?: AbortSignal;
}): Promise<CourseMathSceneAudit | null> {
  if (!hasProviderCredentials("deepseek")) return null;

  const operation = "unit.learning_material.math_scene_audit" as const;
  const audit = await withLlmOperationRoute(operation, () =>
    withExplicitLlmSelection(
      {
        id: "deepseek",
        model: COURSE_MATH_SCENE_AUDIT_MODEL,
        options: {
          chatModel: COURSE_MATH_SCENE_AUDIT_MODEL,
          deepseekThinkingEnabled: false,
        },
      },
      () =>
        runValidatedStructuredGeneration(
          {
            mode: "object",
            schema: courseMathSceneAuditSchema,
            prompt: buildCourseMathSceneAuditPrompt(params),
            options: {
              operation,
              bindingSchema: courseMathSceneAuditSchema,
              meta: {
                mathSceneProductionAudit: true,
                mathSceneObjectCount: params.scene.objects.length,
                platformFunded: true,
              },
            },
            contextSubject: {},
            contextQuery: "",
            contextInvocation: {
              auditKind: "math_scene",
              objectCount: params.scene.objects.length,
            },
          },
          { signal: params.signal },
        ),
    ),
  );

  return audit.result ? { result: true } : audit;
}
