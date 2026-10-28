import { createHash } from "node:crypto";
import {
  END,
  ReducedValue,
  START,
  StateGraph,
  StateSchema,
} from "@langchain/langgraph";
import { z } from "zod";
import { ContentVerificationError } from "../../content-verification/index.js";
import { StructuredGenerationError } from "../../llm/validated-structured-generation.js";
import type { OperationExecutionContext } from "./types.js";

const MAX_CONTEXT_ENTRY_CHARS = 4_000;
const MAX_CONTEXT_CHARS = 16_000;

export const artifactContextEntrySchema = z.object({
  stage: z.string().trim().min(1).max(80),
  kind: z.enum(["related_artifact", "generation_failure", "audit_failure"]),
  summary: z.string().trim().min(1).max(MAX_CONTEXT_ENTRY_CHARS),
  contentHash: z.string().trim().min(1).max(128).optional(),
});

export type ArtifactContextEntry = z.infer<typeof artifactContextEntrySchema>;

export const artifactContextSeedSchema = z.object({
  sequenceId: z.string().trim().min(1).max(240),
  entries: z.array(artifactContextEntrySchema).max(12).default([]),
});

export type ArtifactContextSeed = z.infer<typeof artifactContextSeedSchema>;

export type ArtifactGenerationOutcome<T> =
  | {
      status: "ready";
      sequenceId: string;
      artifact: T;
      attempts: number;
    }
  | {
      status: "retryable";
      sequenceId: string;
      failedStage: "author" | "verify";
      attempts: number;
      issues: string[];
      validPreview?: T;
    };

export class ArtifactGenerationExhaustedError<T = unknown> extends Error {
  readonly retryable = true;

  constructor(
    readonly outcome: Extract<
      ArtifactGenerationOutcome<T>,
      { status: "retryable" }
    >,
  ) {
    super(
      `Artifact generation can be retried from ${outcome.failedStage} after ${outcome.attempts} authoring attempt(s)`,
    );
    this.name = "ArtifactGenerationExhaustedError";
  }
}

export function hashArtifactContext(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function clipped(value: string, max = MAX_CONTEXT_ENTRY_CHARS): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

function issueSummary(error: unknown): string[] {
  if (error instanceof StructuredGenerationError) {
    return error.issues.map((issue) => clipped(issue, 800)).slice(0, 12);
  }
  if (error instanceof ContentVerificationError) {
    return error.issues
      .map(
        (issue) =>
          `${issue.issueCode} at index ${issue.index}: ${clipped(issue.reason, 600)}`,
      )
      .slice(0, 12);
  }
  if (error instanceof Error) return [clipped(error.message, 800)];
  return ["Unknown artifact-generation failure"];
}

function isRecoverable(error: unknown): boolean {
  return (
    error instanceof StructuredGenerationError ||
    error instanceof ContentVerificationError ||
    (typeof error === "object" &&
      error !== null &&
      "retryable" in error &&
      (error as { retryable?: unknown }).retryable === true)
  );
}

export function renderAppendableArtifactPrompt(
  basePrompt: string,
  seed: ArtifactContextSeed,
  entries: readonly ArtifactContextEntry[],
): string {
  const renderEntries = (
    values: readonly ArtifactContextEntry[],
    maxChars: number,
  ): string[] => {
    const rendered: string[] = [];
    let usedChars = 0;
    for (const entry of values) {
      const line = `- [${entry.stage}/${entry.kind}] ${entry.summary}${entry.contentHash ? ` (sha256=${entry.contentHash})` : ""}`;
      if (usedChars + line.length > maxChars) break;
      rendered.push(line);
      usedChars += line.length;
    }
    return rendered;
  };
  const seedLines = renderEntries(seed.entries, MAX_CONTEXT_CHARS);
  let prompt = basePrompt;
  if (seedLines.length > 0) {
    prompt = `${prompt}\n\n[Artifact workflow shared context; the original request remains authoritative]\nsequence=${seed.sequenceId}\n${seedLines.join("\n")}\n[End artifact workflow shared context]`;
  }
  const remainingChars = Math.max(
    0,
    MAX_CONTEXT_CHARS - seedLines.reduce((sum, line) => sum + line.length, 0),
  );
  const appendedLines = renderEntries(entries, remainingChars);
  if (appendedLines.length === 0) return prompt;
  return `${prompt}\n\n[Artifact workflow continuation context]\n${appendedLines.join("\n")}\n[End artifact workflow continuation context]`;
}

export function appendArtifactInvocationContext(
  invocation: unknown,
  seed: ArtifactContextSeed,
  entries: readonly ArtifactContextEntry[],
): Record<string, unknown> {
  const base =
    invocation && typeof invocation === "object" && !Array.isArray(invocation)
      ? (invocation as Record<string, unknown>)
      : { invocation };
  return {
    ...base,
    artifactWorkflow: {
      sequenceId: seed.sequenceId,
      entries: [...seed.entries, ...entries].map((entry) => ({
        stage: entry.stage,
        kind: entry.kind,
        contentHash: entry.contentHash,
      })),
    },
  };
}

export type ArtifactWorkflowRoundContext = {
  attempt: number;
  prompt: string;
  entries: readonly ArtifactContextEntry[];
  invocation: Record<string, unknown>;
};

export async function runArtifactGenerationWorkflow<T>(params: {
  operation: string;
  basePrompt: string;
  contextSeed: ArtifactContextSeed;
  contextInvocation?: unknown;
  executionContext: OperationExecutionContext;
  maxAuthorAttempts?: number;
  author(round: ArtifactWorkflowRoundContext): Promise<T>;
  verify(candidate: T, round: ArtifactWorkflowRoundContext): Promise<T>;
}): Promise<ArtifactGenerationOutcome<T>> {
  const seed = artifactContextSeedSchema.parse(params.contextSeed);
  const maxAuthorAttempts = Math.max(
    1,
    Math.min(params.maxAuthorAttempts ?? 2, 3),
  );
  const entryArraySchema = z.array(artifactContextEntrySchema);
  const ArtifactState = new StateSchema({
    attempts: z.number().int().nonnegative().default(0),
    status: z
      .enum([
        "authoring",
        "author_failed",
        "verifying",
        "verify_failed",
        "ready",
      ])
      .default("authoring"),
    appendedEntries: new ReducedValue(
      entryArraySchema.default(() => []),
      {
        reducer: (current, update) => current.concat(update),
      },
    ),
    candidate: z.custom<T>().optional(),
    artifact: z.custom<T>().optional(),
    failedStage: z.enum(["author", "verify"]).optional(),
    issues: z.array(z.string()).default([]),
  });

  const roundContext = (
    state: typeof ArtifactState.State,
  ): ArtifactWorkflowRoundContext => ({
    attempt: state.attempts + 1,
    prompt: renderAppendableArtifactPrompt(
      params.basePrompt,
      seed,
      state.appendedEntries,
    ),
    entries: [...seed.entries, ...state.appendedEntries],
    invocation: appendArtifactInvocationContext(
      params.contextInvocation,
      seed,
      state.appendedEntries,
    ),
  });

  const graph = new StateGraph(ArtifactState)
    .addNode("author", async (state) => {
      const round = roundContext(state);
      params.executionContext.trace.record({
        type: "agent_round",
        round: round.attempt,
      });
      try {
        const candidate = await params.author(round);
        return {
          attempts: round.attempt,
          status: "verifying" as const,
          candidate,
          issues: [],
          failedStage: undefined,
        };
      } catch (error) {
        if (!isRecoverable(error)) throw error;
        const issues = issueSummary(error);
        return {
          attempts: round.attempt,
          status: "author_failed" as const,
          failedStage: "author" as const,
          issues,
          appendedEntries: [
            {
              stage: `author:${round.attempt}`,
              kind: "generation_failure" as const,
              summary: `The previous strict candidate was rejected. Correct these issues without weakening or changing the requested schema: ${issues.join("; ")}`,
            },
          ],
        };
      }
    })
    .addNode("verify", async (state) => {
      if (state.candidate === undefined) {
        throw new Error(
          "Artifact workflow reached verification without a candidate",
        );
      }
      const round = roundContext(state);
      try {
        const artifact = await params.verify(state.candidate, round);
        return {
          status: "ready" as const,
          artifact,
          issues: [],
          failedStage: undefined,
        };
      } catch (error) {
        if (!isRecoverable(error)) throw error;
        const issues = issueSummary(error);
        return {
          status: "verify_failed" as const,
          failedStage: "verify" as const,
          issues,
          appendedEntries: [
            {
              stage: `verify:${state.attempts}`,
              kind: "audit_failure" as const,
              summary: `The independently audited candidate remained unacceptable. Regenerate a complete strict candidate that addresses: ${issues.join("; ")}`,
            },
          ],
        };
      }
    })
    .addEdge(START, "author")
    .addConditionalEdges("author", (state) => {
      if (state.status === "verifying") return "verify";
      return state.attempts < maxAuthorAttempts ? "author" : END;
    })
    .addConditionalEdges("verify", (state) => {
      if (state.status === "ready") return END;
      return state.attempts < maxAuthorAttempts ? "author" : END;
    })
    .compile();

  const finalState = await graph.invoke(
    { appendedEntries: [] },
    { recursionLimit: maxAuthorAttempts * 3 + 2 },
  );
  if (finalState.status === "ready" && finalState.artifact !== undefined) {
    return {
      status: "ready",
      sequenceId: seed.sequenceId,
      artifact: finalState.artifact,
      attempts: finalState.attempts,
    };
  }
  const outcome: Extract<
    ArtifactGenerationOutcome<T>,
    { status: "retryable" }
  > = {
    status: "retryable",
    sequenceId: seed.sequenceId,
    failedStage: finalState.failedStage ?? "author",
    attempts: finalState.attempts,
    issues: finalState.issues,
    ...(finalState.failedStage === "verify" &&
    finalState.candidate !== undefined
      ? { validPreview: finalState.candidate }
      : {}),
  };
  await params.executionContext.events.emit({
    type: "retryable",
    operation: params.operation,
    sequenceId: seed.sequenceId,
    failedStage: outcome.failedStage,
    attempts: outcome.attempts,
    issues: outcome.issues,
    validPreviewAvailable: outcome.validPreview !== undefined,
  });
  throw new ArtifactGenerationExhaustedError(outcome);
}
