import { z } from "zod";
import { runValidatedStructuredGeneration } from "../../llm/validated-structured-generation.js";
import { type StreamTokenHandler } from "../../llm/chat-stream.js";
import { defineLearningSystemCapability } from "../define-capability.js";
import type { ContextEnvelope } from "../types.js";
import { MAP_REFINEMENT_VIEW_KEYS } from "../../llm/map-refinement-keys.js";

export type RefineMapUnit = {
  id: string;
  title: string;
  parentUnitId: string | null;
  orderIndex: number;
  unitKind: string;
  contentSummary: string;
  mapOrigin: string;
  mapEdited: boolean;
};

export const refineMapNodeSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  contentSummary: z.string().min(1),
  orderIndex: z.number().int().min(0),
});

export const refineMapResultSchema = z.object({
  nodes: z.array(refineMapNodeSchema).min(1),
});

export type RefineMapResult = z.infer<typeof refineMapResultSchema>;

function formatNode(unit: RefineMapUnit): string {
  const parent = unit.parentUnitId ?? "ROOT";
  return [
    `id=${unit.id}`,
    `parent=${parent}`,
    `order=${unit.orderIndex}`,
    `kind=${unit.unitKind}`,
    `origin=${unit.mapOrigin}`,
    `edited=${unit.mapEdited ? "yes" : "no"}`,
    `title=${unit.title}`,
    `summary=${unit.contentSummary}`,
  ].join(" | ");
}

export function buildMapRefinementPrompt(params: {
  goalTitle: string;
  nodes: RefineMapUnit[];
  adjustment: string;
}) {
  return `Lightly refresh one visible level of a XueLearn map.
Goal: ${params.goalTitle}

Task: ${params.adjustment}

Current level nodes:
${params.nodes.map(formatNode).join("\n")}

Rules:
- Return each given id exactly once. Do not add/delete ids.
- Only improve title, contentSummary, and orderIndex for this level.
- You may improve both AI and user-created node titles/summaries.
- Keep the same language and intent. Be concise.
- Do not mention ids in titles/summaries.
- orderIndex starts at 0 and applies only within this current level.

JSON only: {"nodes":[{"id":"existing id","title":"improved title","contentSummary":"improved 1-2 sentence summary","orderIndex":0}]}`;
}

export function createMapRefinementCapability() {
  const capabilityId = "map-refinement";
  const version = "1.1.0";
  const instruction = `Refine the supplied visible XueLearn map level without changing its identity set.
- Preserve every supplied node id exactly once and do not add or delete nodes.
- Change only titles, summaries, and sibling order as requested by the invocation.
- Keep the goal's language, scope, and intent.`;
  return defineLearningSystemCapability({
    id: capabilityId,
    version,
    kind: "learning_system",
    views: {
      [MAP_REFINEMENT_VIEW_KEYS.instructionContext]: async ({
        subject,
      }): Promise<ContextEnvelope | null> => {
        return {
          ownerCapabilityId: capabilityId,
          ownerCapabilityVersion: version,
          schemaVersion: 1,
          authority: "server_policy",
          scope: { ...subject },
          freshness: { asOf: new Date().toISOString(), stale: false },
          data: {
            promptBlock: instruction,
          },
        };
      },
    },
  });
}

export async function refineMapOrderAndTitles(params: {
  goalTitle: string;
  units: RefineMapUnit[];
  adjustment: string;
  onToken?: StreamTokenHandler;
  signal?: AbortSignal;
}): Promise<RefineMapResult> {
  const nodes = params.units
    .filter((unit) => unit.unitKind !== "overview")
    .sort((a, b) => {
      const parentCompare = (a.parentUnitId ?? "").localeCompare(
        b.parentUnitId ?? "",
      );
      return parentCompare || a.orderIndex - b.orderIndex;
    });

  return runValidatedStructuredGeneration(
    {
      mode: "object",
      schema: refineMapResultSchema,
      prompt: buildMapRefinementPrompt({
        goalTitle: params.goalTitle,
        nodes,
        adjustment: params.adjustment,
      }),
      options: {
        operation: "goal.map.refine",
        schemaShape: `{"nodes":[{"id":"existing id","title":"title","contentSummary":"summary","orderIndex":0}]}`,
        meta: { goalTitle: params.goalTitle },
      },
      contextSubject: {},
      contextQuery: params.adjustment.slice(0, 2_000),
      contextInvocation: {
        goalTitle: params.goalTitle,
        nodes,
        adjustment: params.adjustment,
      },
    },
    { onToken: params.onToken, signal: params.signal },
  );
}
