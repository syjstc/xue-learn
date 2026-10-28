import { RUIYAN_SHADOW_GUIDED_IMAGE_INSTRUCTION, withCurrentCourseDisplayInstructions } from "../learning-systems/capabilities/unit-content/material-prompt.js";
import { loadDisplayAuthoringCatalog, displayCatalogInstruction } from "../display-build/catalog.js";
import { acceptedDisplayBuildDrafts, createDisplayTopicSchema, createDisplayTopicTool, enqueueDisplayTopic, type DisplayBuildTopicDraft } from "./display-topic.js";
import { acceptedGuidedImageDrafts, completeGuidedImageTopic, createGuidedImageTopicSchema, guidedImageTopicTool, type GuidedImageTopicDraft } from "./guided-image-topic.js";
import { publishedTopicRewrite } from "./published-topic-rewrite.js";
import { parseFlattenedMaterialItems } from "./section-material-envelope.js";
import type { LearningMaterialContent } from "../llm/schemas.js";
import { isImageGenerationAvailable } from "../images/providers/index.js";
import { isGeneralEducationCourse } from "../learning-spaces/course-display-policy.js";
import { GENERAL_EDUCATION_DISPLAY_INSTRUCTION } from "../llm/general-education-display-policy.js";
import { supportsDisplay, getActivePresentationCapabilities, presentationCapabilityInstruction, runWithPresentationCapabilities } from "../llm/display-capabilities.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  prepareGenerationInvocation,
  runMergedGenerationContextScope,
} from "../generation/kernel.js";
import type { LearningSystemSubject } from "../learning-systems/types.js";
import {
  normalizeSurveyPreviewEnvelopeCandidate,
  prepareSurveyAuthoring,
  surveyItemsFromProviderPayload,
  type PrepareSurveyAuthoringInput,
  type SurveyPreview,
} from "../survey/authoring.js";
import { FORMAL_DERIVATION_CONTENT_KIND_RULE } from "../survey/formal-derivation-planning.js";
import {
  prepareSectionPlanAuthoring,
  type PrepareSectionPlanAuthoringInput,
  type SurveySectionPlanObject,
} from "../survey/section-plan.js";
import type { LlmMessageRecord } from "../agents/core/types.js";
import { runWithLlmTraceAsync } from "../llm/trace-context.js";
import {
  materialItemsFromProviderPayload,
  materialGenerationJitItemSchema,
  type MaterialGenerationJitItem,
} from "../llm/jit-structured-items.js";
import {
  acceptedSectionTopicsCommit,
  acceptedTopicMaterials,
  createTopicMaterialCommitSchema,
  fallbackTopicMaterial,
  flattenSectionTopicsToJitItems,
  flattenTopicToJitItems,
  omitTopicMaterialCommits,
  resolveRewriteTopicId,
  topicMaterialRoundUserPrompt,
  sectionTopicsAuthoringSchema,
  type SectionTopicsCommit,
  type TopicMaterialCommit,
} from "../llm/material-topic.js";
import { topicMaterialLanguageLock } from "../llm/content-language.js";
import type { ComponentCategorySelection } from "../llm/component-dsl-registry.js";
import {
  UNIT_AUTHORING_OPERATION,
  compactUnitAuthoringStagePrompt,
  runUnitAuthoringAgentRound,
  splitUnitAuthoringBootstrapPrompt,
  type UnitAuthoringToolName,
} from "./agent-round.js";
import { unitAuthoringAgentEnabled } from "./flags.js";
import {
  resolveUnitAuthoringHistoryPrefix,
} from "./history.js";
import {
  appendUnitAuthoringMessage,
  ensureUnitAuthoringSession,
  filterTranscriptBeforeSection,
  loadUnitAuthoringTranscript,
  loadUnitAuthoringTranscriptRecords,
  messagesForAuthoringSection,
  saveUnitAuthoringState,
  type StoredUnitAuthoringMessage,
  type UnitAuthoringStage,
} from "./session.js";

export { unitAuthoringAgentEnabled } from "./flags.js";

export function sectionPlanContinuationPrompt(input: {
  outline: readonly string[];
  languageBlock?: string;
}): string {
  const frozenOutline = input.outline
    .map((item, index) => `${index}. ${item}`)
    .join("\n");
  return `Group the accepted Survey outline below into 1-4 contiguous teaching sections.
The numbered list is the server-authoritative outline. Do not infer indexes from guiding questions or other transcript items. Cover every listed index exactly once, in order.
Frozen outline (${input.outline.length} items):
${frozenOutline}
${input.languageBlock?.trim() ? `${input.languageBlock.trim()}\n` : ""}${FORMAL_DERIVATION_CONTENT_KIND_RULE} Call commit_section_plan with the grouping only.`;
}

export function sectionMaterialCommitMessages(
  records: readonly StoredUnitAuthoringMessage[],
  sectionId: string,
  force = false,
): LlmMessageRecord[] {
  if (force) return [];
  return messagesForAuthoringSection(records, sectionId);
}

function acceptedToolResult<T>(
  transcript: readonly LlmMessageRecord[],
  toolName: UnitAuthoringToolName,
  schema: z.ZodType<T>,
): T | null {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index];
    if (message?.role !== "assistant") continue;
    const call = message.toolCalls?.find(
      (candidate) => candidate.name === toolName,
    );
    if (!call) continue;
    const parsed = schema.safeParse(call.args);
    return parsed.success ? parsed.data : null;
  }
  return null;
}

async function persistRound(input: {
  threadId: string;
  stage: UnitAuthoringStage;
  sectionId?: string;
  messages: readonly LlmMessageRecord[];
  branchKind?:
    | "main"
    | "svg"
    | "component"
    | "html"
    | "notes"
    | "assessment"
    | "audit"
    | "repair";
}) {
  let lastMessageId: string | null = null;
  for (const message of input.messages) {
    const stored = await appendUnitAuthoringMessage({
      threadId: input.threadId,
      stage: input.stage,
      sectionId: input.sectionId,
      message,
      branchKind: input.branchKind,
    });
    lastMessageId = stored.id;
  }
  return lastMessageId;
}

async function persistAgentRound(input: {
  threadId: string;
  stage: UnitAuthoringStage;
  sectionId?: string;
  round: {
    repairMessages: readonly LlmMessageRecord[];
    userMessage: LlmMessageRecord;
    assistantMessage: LlmMessageRecord;
    toolMessage: LlmMessageRecord;
  };
  leadingMessages?: readonly LlmMessageRecord[];
  branchKind?:
    | "main"
    | "svg"
    | "component"
    | "html"
    | "notes"
    | "assessment"
    | "audit"
    | "repair";
}) {
  if (input.leadingMessages?.length) {
    await persistRound({
      threadId: input.threadId,
      stage: input.stage,
      sectionId: input.sectionId,
      messages: input.leadingMessages,
      branchKind: input.branchKind,
    });
  }
  if (input.round.repairMessages.length > 0) {
    await persistRound({
      threadId: input.threadId,
      stage: input.stage,
      sectionId: input.sectionId,
      messages: input.round.repairMessages,
      branchKind: "repair",
    });
  }
  return persistRound({
    threadId: input.threadId,
    stage: input.stage,
    sectionId: input.sectionId,
    messages: [
      input.round.userMessage,
      input.round.assistantMessage,
      input.round.toolMessage,
    ],
    branchKind: input.branchKind,
  });
}

export async function runComponentSelectionAuthoringAgent(input: {
  userId: string;
  goalId: string;
  unitId: string;
  prompt: string;
  resultSchema: z.ZodType<ComponentCategorySelection>;
  contextSubject: LearningSystemSubject;
  contextQuery: string;
  contextInvocation?: unknown;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
}): Promise<ComponentCategorySelection> {
  const session = await ensureUnitAuthoringSession(input);
  const transcript = await loadUnitAuthoringTranscript(session.threadId);
  const recovered = acceptedToolResult(
    transcript,
    "commit_component_selection",
    input.resultSchema,
  );
  if (recovered) return recovered;
  const prepared = await runMergedGenerationContextScope(
    {
      subject: input.contextSubject,
      query: input.contextQuery,
      invocation: input.contextInvocation,
    },
    () => prepareGenerationInvocation(UNIT_AUTHORING_OPERATION, input.prompt),
  );
  const bootstrap = splitUnitAuthoringBootstrapPrompt(prepared.prompt);
  const bootstrapMessages: LlmMessageRecord[] = bootstrap.systemPrompt
    ? [{ role: "system", content: bootstrap.systemPrompt }]
    : [];
  const round = await runWithLlmTraceAsync(
    { traceId: session.state.traceId },
    () =>
      runUnitAuthoringAgentRound({
        transcript: [...bootstrapMessages, ...transcript],
        prompt: bootstrap.userPrompt,
        expectedTool: "commit_component_selection",
        resultSchema: input.resultSchema,
        signal: input.signal,
        meta: input.meta,
      }),
  );
  const lastMessageId = await persistAgentRound({
    threadId: session.threadId,
    stage: "component_selection",
    leadingMessages: bootstrapMessages,
    round,
  });
  await saveUnitAuthoringState(session.threadId, {
    ...session.state,
    stage: "survey",
    basePromptHash: createHash("sha256").update(prepared.prompt).digest("hex"),
    lastMessageId,
  });
  return round.result;
}

export async function runSurveyAuthoringAgent(input: {
  userId: string;
  goalId: string;
  unitId: string;
  authoring: PrepareSurveyAuthoringInput;
  promptOverride?: string;
  contextSubject: LearningSystemSubject;
  contextQuery: string;
  contextInvocation?: unknown;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onToken?: (delta: string) => void | Promise<void>;
  onPartial?: (candidate: unknown) => void | Promise<void>;
}): Promise<SurveyPreview> {
  const prepared = prepareSurveyAuthoring(input.authoring);
  const session = await ensureUnitAuthoringSession(input);
  const transcript = await loadUnitAuthoringTranscript(session.threadId);
  const resultSchema = z.preprocess(
    surveyItemsFromProviderPayload,
    prepared.resultSchema,
  );
  const recovered = acceptedToolResult(
    transcript,
    "commit_survey",
    resultSchema,
  );
  if (recovered) return recovered;
  const firstPrompt =
    transcript.length > 0
      ? { prompt: input.promptOverride ?? prepared.prompt }
      : await runMergedGenerationContextScope(
          {
            subject: input.contextSubject,
            query: input.contextQuery,
            invocation: input.contextInvocation ?? prepared.contextInvocation,
          },
          () =>
            prepareGenerationInvocation(
              UNIT_AUTHORING_OPERATION,
              input.promptOverride ?? prepared.prompt,
            ),
        );
  const bootstrap =
    transcript.length === 0
      ? splitUnitAuthoringBootstrapPrompt(firstPrompt.prompt)
      : { userPrompt: firstPrompt.prompt };
  const bootstrapMessages: LlmMessageRecord[] = bootstrap.systemPrompt
    ? [{ role: "system", content: bootstrap.systemPrompt }]
    : [];
  const round = await runWithLlmTraceAsync(
    { traceId: session.state.traceId },
    () =>
      runUnitAuthoringAgentRound({
        transcript: [...bootstrapMessages, ...transcript],
        prompt: compactUnitAuthoringStagePrompt(
          bootstrap.userPrompt,
          transcript,
        ),
        expectedTool: "commit_survey",
        resultSchema,
        signal: input.signal,
        meta: input.meta,
        onToken: input.onToken,
        onPartialCandidate: async (candidate) =>
          input.onPartial?.(normalizeSurveyPreviewEnvelopeCandidate(candidate)),
      }),
  );
  // Persist the accepted, normalized Survey rather than the provider's raw
  // arguments. Normalization can cap the outline at eight items; replaying the
  // uncapped call would make the next section-plan turn see a different outline
  // from the one its server schema validates.
  const acceptedSurveyArgs = {
    items: [
      ...round.result.survey.outline.map((text, index) => {
        const section = round.result.survey.sectionOutline?.[index];
        return {
          kind: "outline" as const,
          text,
          ...(section?.scope ? { scope: section.scope } : {}),
          ...(section?.learningTargetIds
            ? { learningTargetIds: section.learningTargetIds }
            : {}),
          ...(section ? { checkpointAfter: section.checkpointAfter } : {}),
        };
      }),
      ...round.result.questions.map((question) => ({
        kind: "question" as const,
        text: question.text,
        learningTargetIds: question.learningTargetIds,
      })),
    ],
  };
  if (round.assistantMessage.toolCalls?.[0]) {
    round.assistantMessage.toolCalls[0].args = acceptedSurveyArgs;
  }
  const lastMessageId = await persistAgentRound({
    threadId: session.threadId,
    stage: "survey",
    leadingMessages: bootstrapMessages,
    round,
  });
  await saveUnitAuthoringState(session.threadId, {
    ...session.state,
    stage: "section_plan",
    basePromptHash: createHash("sha256")
      .update(firstPrompt.prompt)
      .digest("hex"),
    lastMessageId,
  });
  return round.result;
}

export async function runSectionPlanAuthoringAgent(input: {
  userId: string;
  goalId: string;
  unitId: string;
  authoring: PrepareSectionPlanAuthoringInput;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
}): Promise<SurveySectionPlanObject> {
  const prepared = prepareSectionPlanAuthoring(input.authoring);
  const session = await ensureUnitAuthoringSession(input);
  const transcript = await loadUnitAuthoringTranscript(session.threadId);
  const recovered = acceptedToolResult(
    transcript,
    "commit_section_plan",
    prepared.resultSchema,
  );
  if (recovered) return recovered;
  if (!acceptedToolResult(transcript, "commit_survey", z.unknown())) {
    throw new Error(
      "Unit authoring Survey must be committed before section planning",
    );
  }
  const round = await runWithLlmTraceAsync(
    { traceId: session.state.traceId },
    () =>
      runUnitAuthoringAgentRound({
        transcript,
        prompt: sectionPlanContinuationPrompt(input.authoring),
        expectedTool: "commit_section_plan",
        resultSchema: prepared.resultSchema,
        signal: input.signal,
        meta: input.meta,
      }),
  );
  const lastMessageId = await persistAgentRound({
    threadId: session.threadId,
    stage: "section_plan",
    round,
  });
  await saveUnitAuthoringState(session.threadId, {
    ...session.state,
    stage: "section_material",
    lastMessageId,
  });
  return round.result;
}

function emitPartialMaterialItems(
  items: unknown,
  onPartial?: (items: MaterialGenerationJitItem[]) => void | Promise<void>,
): Promise<void> {
  if (!onPartial) return Promise.resolve();
  const parsed = z.array(z.unknown()).safeParse(items);
  if (!parsed.success) return Promise.resolve();
  const validItems = parsed.data.flatMap((item) => {
    const valid = materialGenerationJitItemSchema.safeParse(item);
    return valid.success ? [valid.data] : [];
  });
  return Promise.resolve(onPartial(validItems));
}

async function runSectionMaterialAuthoringAgentInScope(input: {
  userId: string;
  goalId: string;
  unitId: string;
  sectionId: string;
  prompt: string;
  resultSchema: z.ZodType<MaterialGenerationJitItem[]>;
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  skipSurvey?: boolean;
  force?: boolean;
  rewriteTopicId?: string;
  rewriteTopicIndex?: number;
  publishedMaterial?: LearningMaterialContent;
  languageBlock?: string;
  guidedImagePersonaRef?: string;
  imageRepairRetryKey?: string;
  onToken?: (delta: string) => void | Promise<void>;
  onPartial?: (items: MaterialGenerationJitItem[]) => void | Promise<void>;
}): Promise<MaterialGenerationJitItem[]> {
  const displayManifests = await loadDisplayAuthoringCatalog();
  const pluginInstruction = displayCatalogInstruction(displayManifests);
  if (pluginInstruction) input = {...input, prompt: `${input.prompt}\n\n${pluginInstruction}`};
  const imageFirst = Boolean(input.guidedImagePersonaRef) && supportsDisplay("guided_image_intent");
  if (imageFirst) input = { ...input, prompt: `${input.prompt}\n\n${RUIYAN_SHADOW_GUIDED_IMAGE_INSTRUCTION}` };
  const session = await ensureUnitAuthoringSession(input);
  const records = await loadUnitAuthoringTranscriptRecords(session.threadId);
  // The initial material action also sends force=true when retried after a
  // failure. Until this section has ever completed, keep its accepted image
  // intent and child checkpoints instead of paying for another image.
  if (imageFirst && input.force && !session.state.completedSectionIds.includes(input.sectionId)
    && !input.rewriteTopicId && typeof input.rewriteTopicIndex !== "number") {
    input = { ...input, force: false };
  }
  const rawTranscript = records.map((record) => record.message);
  const sectionMessages = sectionMaterialCommitMessages(
    records,
    input.sectionId,
    Boolean(input.force),
  );
  const recoverGuided = async (messages: readonly LlmMessageRecord[], allowed: readonly string[], materials: Map<string, TopicMaterialCommit>, omit?: string | null) => {
    for (const [topicId, saved] of acceptedDisplayBuildDrafts(messages, allowed)) {
      if (topicId === omit) continue;
      materials.set(topicId, await enqueueDisplayTopic({...input, ...saved, manifests: displayManifests}));
    }
    for (const [topicId, saved] of acceptedGuidedImageDrafts(messages, allowed)) {
      if (topicId === omit) continue;
      materials.set(topicId, await completeGuidedImageTopic({
        ...input, ...saved, personaRef: input.guidedImagePersonaRef ?? "builtin:ruiyan_shadow_female",
      }));
    }
  };
  const rewriteRequested =
    Boolean(input.rewriteTopicId?.trim()) ||
    typeof input.rewriteTopicIndex === "number";
  const publishedRewrite = rewriteRequested && input.publishedMaterial
    ? publishedTopicRewrite(input.publishedMaterial, { topicId: input.rewriteTopicId, topicIndex: input.rewriteTopicIndex })
    : null;
  const wireSchema = z.preprocess(
    materialItemsFromProviderPayload,
    input.resultSchema,
  );
  if (!input.force && !rewriteRequested) {
    const recoveredLegacy = acceptedToolResult(
      sectionMessages,
      "commit_section_material",
      wireSchema,
    );
    if (
      recoveredLegacy &&
      session.state.completedSectionIds.includes(input.sectionId)
    ) {
      return recoveredLegacy;
    }
    const recoveredOutline = acceptedSectionTopicsCommit(sectionMessages);
    if (
      recoveredOutline &&
      session.state.completedSectionIds.includes(input.sectionId)
    ) {
      const recoveredTopics = acceptedTopicMaterials(
        sectionMessages,
        recoveredOutline.topics.map((topic) => topic.id),
      );
      await recoverGuided(sectionMessages, recoveredOutline.topics.map((topic) => topic.id), recoveredTopics);
      if (
        recoveredOutline.topics.every((topic) => recoveredTopics.has(topic.id))
      ) {
        const assembled = flattenSectionTopicsToJitItems(
          recoveredOutline,
          recoveredTopics,
        );
        try {
          return parseFlattenedMaterialItems(
            assembled,
            input.resultSchema,
            imageFirst,
          );
        } catch {
          // Recovered transcript is incomplete for the current envelope.
        }
      }
    }
  }
  if (
    !input.skipSurvey &&
    !acceptedToolResult(rawTranscript, "commit_survey", z.unknown())
  ) {
    throw new Error("Unit authoring Survey must be committed before material");
  }
  const generalEducation = await isGeneralEducationCourse(input.userId, input.goalId);
  const displayInstruction = generalEducation ? GENERAL_EDUCATION_DISPLAY_INSTRUCTION : "";
  if (displayInstruction) input = { ...input, prompt: `${input.prompt}\n\n${displayInstruction}` };
  let transcript = input.force
    ? filterTranscriptBeforeSection(records, input.sectionId)
    : rawTranscript;

  const persistCompleted = async (lastMessageId: string | null) => {
    await saveUnitAuthoringState(session.threadId, {
      ...session.state,
      stage: "section_material",
      currentSectionId: input.sectionId,
      completedSectionIds: [
        ...new Set([...session.state.completedSectionIds, input.sectionId]),
      ],
      lastMessageId,
    });
  };

  const emitFlattened = async (
    outline: SectionTopicsCommit,
    materials: ReadonlyMap<string, TopicMaterialCommit>,
  ) => {
    if (publishedRewrite) {
      const replacement = materials.get(publishedRewrite.topic.id);
      if (replacement) await emitPartialMaterialItems(publishedRewrite.assemble(replacement), input.onPartial);
      return;
    }
    await emitPartialMaterialItems(
      flattenSectionTopicsToJitItems(outline, materials),
      input.onPartial,
    );
  };

  let outline = publishedRewrite ? { topics: [publishedRewrite.topic] } : acceptedSectionTopicsCommit(sectionMessages);
  if (!outline) {
    const round = await runWithLlmTraceAsync(
      { traceId: session.state.traceId },
      () =>
        runUnitAuthoringAgentRound({
          transcript,
          prompt: withCurrentCourseDisplayInstructions(
            compactUnitAuthoringStagePrompt(
              `${input.prompt}\n\nFirst call commit_section_topics with an optional introduction and the ordered small-topic titles for this section. Do not call commit_topic_material or commit_section_material yet.\n\n${topicMaterialLanguageLock(input.languageBlock ?? "", "outline")}`,
              transcript,
            ),
            transcript,
            { capabilities: getActivePresentationCapabilities(), imageFirst, pluginInstruction },
          ),
          expectedTool: "commit_section_topics",
          resultSchema: sectionTopicsAuthoringSchema,
          signal: input.signal,
          meta: { ...input.meta, sectionId: input.sectionId, topicStage: "outline" },
          onToken: input.onToken,
        }),
    );
    const lastMessageId = await persistAgentRound({
      threadId: session.threadId,
      stage: "section_material",
      sectionId: input.sectionId,
      round,
    });
    transcript = [
      ...transcript,
      round.userMessage,
      round.assistantMessage,
      round.toolMessage,
    ];
    outline = round.result;
    await saveUnitAuthoringState(session.threadId, {
      ...session.state,
      stage: "section_material",
      currentSectionId: input.sectionId,
      lastMessageId,
    });
  }

  const allowedTopicIds = outline.topics.map((topic) => topic.id);
  const rewriteTopicId = publishedRewrite?.topic.id ?? (rewriteRequested
    ? resolveRewriteTopicId(outline, {
        topicId: input.rewriteTopicId,
        topicIndex: input.rewriteTopicIndex,
      })
    : null);
  if (rewriteRequested && !rewriteTopicId) {
    throw new Error(
      "That topic is not in this section's outline; regenerate the section instead.",
    );
  }
  const rewriteRoundPrompt = publishedRewrite?.prompt ?? (rewriteTopicId
    ? topicMaterialRoundUserPrompt(transcript, rewriteTopicId)
    : null);
  if (rewriteTopicId) {
    transcript = omitTopicMaterialCommits(transcript, rewriteTopicId);
  }
  const materials = acceptedTopicMaterials(sectionMessages, allowedTopicIds);
  if (publishedRewrite) materials.delete(publishedRewrite.topic.id);
  await recoverGuided(sectionMessages, allowedTopicIds, materials, rewriteTopicId);
  if (materials.size > 0) {
    await emitFlattened(outline, materials);
  }

  let lastMessageId: string | null = session.state.lastMessageId;
  const topicSchema = (topicId: string) =>
    createDisplayTopicSchema((imageFirst ? createGuidedImageTopicSchema : createTopicMaterialCommitSchema)({
      allowedTopicIds,
      expectedTopicId: topicId,
      generalEducation,
      validateLearnerContent: true,
      imagesEnabled: getActivePresentationCapabilities() ? isImageGenerationAvailable() : undefined,
    }), displayManifests, topicId);
  const displayTopicTool = createDisplayTopicTool(displayManifests, imageFirst);
  const topicPrompt = (topic: { id: string; title: string }) =>
    `${pluginInstruction}\n${imageFirst ? RUIYAN_SHADOW_GUIDED_IMAGE_INSTRUCTION + "\n" : ""}${presentationCapabilityInstruction(isImageGenerationAvailable()) ? presentationCapabilityInstruction(isImageGenerationAvailable()) + "\n" : ""}Call commit_topic_material for topicId ${JSON.stringify(topic.id)} titled ${JSON.stringify(topic.title)} only. One display (atomic figure or ${getActivePresentationCapabilities()?.stageRoles ? "one main figure plus one brief helper" : `a stage of 2–${getActivePresentationCapabilities()?.maxStageFigures ?? 4} figures`} with ids) and as many lecture-style spoken cues as needed to teach it clearly. An asynchronous display_build uses empty cues because its component agent owns the complete narration. Give every display, side, figure, and code region a short unique id. Each ordinary cue needs text plus targetIds listing one or more actual ids. Do not rewrite accepted topics: ${[...materials.keys()].filter((id) => id !== topic.id).join(", ") || "(none yet)"}.`;
  const topicRoundPrompt = (
    topic: { id: string; title: string },
    extra = "",
    history: readonly LlmMessageRecord[] = transcript,
  ) =>
    `${compactUnitAuthoringStagePrompt(
      `${topicPrompt(topic)}\n${displayInstruction}${extra}`,
      history,
    )}\n\n${topicMaterialLanguageLock(input.languageBlock ?? "", topic.id)}`;

  for (const topic of outline.topics) {
    if (materials.has(topic.id) && topic.id !== rewriteTopicId) continue;
    let material: TopicMaterialCommit | GuidedImageTopicDraft | DisplayBuildTopicDraft | null = null;
    let imageRevisionId = "";
    const prompt = withCurrentCourseDisplayInstructions(
      topic.id === rewriteTopicId && rewriteRoundPrompt
        ? `${rewriteRoundPrompt}\n\n${displayInstruction}`
        : topicRoundPrompt(topic),
      transcript,
      { capabilities: getActivePresentationCapabilities(), imageFirst, pluginInstruction },
    );
    try {
      const round = await runWithLlmTraceAsync(
        { traceId: session.state.traceId },
        () =>
          runUnitAuthoringAgentRound({
            transcript,
            prompt,
            expectedTool: "commit_topic_material",
            toolCatalog: [displayTopicTool],
            resultSchema: topicSchema(topic.id),
            signal: input.signal,
            meta: {
              ...input.meta,
              sectionId: input.sectionId,
              topicId: topic.id,
            },
            onToken: input.onToken,
          }),
      );
      lastMessageId = await persistAgentRound({
        threadId: session.threadId,
        stage: "section_material",
        sectionId: input.sectionId,
        round,
      });
      transcript = [
        ...transcript,
        round.userMessage,
        round.assistantMessage,
        round.toolMessage,
      ];
      material = round.result;
      imageRevisionId = round.assistantMessage.toolCalls?.[0]?.id ?? lastMessageId ?? "";
    } catch (error) {
      const validationError =
        error instanceof Error ? error.message : String(error);
      try {
        const cold = await runWithLlmTraceAsync(
          { traceId: session.state.traceId },
          () =>
            runUnitAuthoringAgentRound({
              transcript: [],
              prompt: withCurrentCourseDisplayInstructions(
                topicRoundPrompt(
                  topic,
                  `\n\nPrevious attempt failed:\n${validationError}`,
                  [],
                ),
                [],
                { capabilities: getActivePresentationCapabilities(), imageFirst, pluginInstruction },
              ),
              expectedTool: "commit_topic_material",
              toolCatalog: [displayTopicTool],
              resultSchema: topicSchema(topic.id),
              operation: "unit.authoring_agent.cold_repair",
              signal: input.signal,
              meta: {
                ...input.meta,
                sectionId: input.sectionId,
                topicId: topic.id,
                coldRepair: true,
              },
              onToken: input.onToken,
            }),
        );
        lastMessageId = await persistAgentRound({
          threadId: session.threadId,
          stage: "section_material",
          sectionId: input.sectionId,
          round: cold,
          branchKind: "repair",
        });
        material = cold.result;
        imageRevisionId = cold.assistantMessage.toolCalls?.[0]?.id ?? lastMessageId ?? "";
      } catch (repairError) {
        if (imageFirst || displayManifests.length || input.signal?.aborted) throw repairError;
        material = fallbackTopicMaterial({
          topicId: topic.id,
          title: topic.title,
        });
      }
    }
    if (material.display.type === "display_build") {
      // The accepted intent is already durable in the transcript. Persist the
      // immutable job and slot, then continue the next topic without awaiting its agent.
      material = await enqueueDisplayTopic({...input, draft: material as DisplayBuildTopicDraft,
        revisionId: imageRevisionId, manifests: displayManifests});
    }
    if (material.display.type === "guided_image_intent") {
      // Persisted intent precedes every expensive child step. Image failures are
      // outside the text fallback catch: retry must resume the child, not publish
      // a different lesson or prematurely narrate an unseen picture.
      const completed = await completeGuidedImageTopic({
        ...input, draft: material as GuidedImageTopicDraft, revisionId: imageRevisionId,
        personaRef: input.guidedImagePersonaRef ?? "builtin:ruiyan_shadow_female",
      });
      const message: LlmMessageRecord = { role: "user", content:
        `Server-completed image teaching topic ${topic.id}. The image and regions are frozen. Accepted narration for continuity with subsequent topics:\n${completed.cues.map((cue) => cue.text).join("\n")}` };
      await appendUnitAuthoringMessage({ threadId: session.threadId, stage: "section_material", sectionId: input.sectionId, branchKind: "component", message });
      transcript = [...transcript, message];
      material = completed;
    }
    materials.set(topic.id, material as TopicMaterialCommit);
    await emitFlattened(outline, materials);
  }

  const assembled = publishedRewrite
    ? publishedRewrite.assemble(materials.get(publishedRewrite.topic.id)!)
    : flattenSectionTopicsToJitItems(outline, materials);
  if (publishedRewrite) {
    // Apply new authoring rules only to the replacement. Published neighbors may
    // contain historical prose/list shapes and must not be rewritten to pass them.
    parseFlattenedMaterialItems(flattenTopicToJitItems(publishedRewrite.topic, materials.get(publishedRewrite.topic.id)!), input.resultSchema, true);
  }
  const parsed = publishedRewrite
    ? z.array(materialGenerationJitItemSchema).parse(assembled)
    : parseFlattenedMaterialItems(assembled, input.resultSchema, imageFirst);
  await persistCompleted(lastMessageId);
  return parsed;
}

/**
 * Continue a durable unit-authoring transcript for a downstream unit.* call
 * (Cornell, flashcards, quiz, …). Reuses the accepted Survey/material prefix
 * for provider input cache; does not advance the main authoring stage.
 */
export async function runUnitAuthoringHistoryBoundCall<TResult>(input: {
  userId: string;
  goalId: string;
  unitId: string;
  operation: string;
  expectedTool: UnitAuthoringToolName;
  prompt: string;
  resultSchema: z.ZodType<TResult>;
  branchKind: "notes" | "assessment" | "svg" | "component" | "html" | "audit";
  requireCommits?: readonly string[];
  signal?: AbortSignal;
  meta?: Record<string, unknown>;
  onToken?: (delta: string) => void | Promise<void>;
  onPartialCandidate?: (candidate: unknown) => void | Promise<void>;
}): Promise<TResult | null> {
  const history = await resolveUnitAuthoringHistoryPrefix({
    userId: input.userId,
    goalId: input.goalId,
    unitId: input.unitId,
    requireCommits: input.requireCommits ?? [
      "commit_survey",
      "commit_section_material",
    ],
  });
  if (!history.available) return null;
  const round = await runWithLlmTraceAsync(
    { traceId: history.state.traceId },
    () =>
      runUnitAuthoringAgentRound({
        transcript: history.messages,
        prompt: compactUnitAuthoringStagePrompt(
          input.prompt,
          history.messages,
        ),
        expectedTool: input.expectedTool,
        resultSchema: input.resultSchema,
        operation: input.operation,
        signal: input.signal,
        meta: {
          ...input.meta,
          unitAuthoringHistoryReuse: true,
          branchKind: input.branchKind,
          transcriptMessageCount: history.messages.length,
        },
        onToken: input.onToken,
        onPartialCandidate: input.onPartialCandidate,
      }),
  );
  await persistAgentRound({
    threadId: history.threadId,
    // Downstream notes/assessment stay on the current material stage marker.
    stage: history.state.stage,
    round,
    branchKind: input.branchKind,
  });
  return round.result;
}

/** Resume under the immutable facts accepted before the first provider call. */
export async function runSectionMaterialAuthoringAgent(input: Parameters<typeof runSectionMaterialAuthoringAgentInScope>[0]): Promise<MaterialGenerationJitItem[]> {
  const session = await ensureUnitAuthoringSession(input);
  return runWithPresentationCapabilities(session.state.presentationCapabilities, () => runSectionMaterialAuthoringAgentInScope(input));
}
