import { beginLearningGuidanceTurn, guidanceContext } from "../learning-trajectory/service.js";
import type { LearningPosition } from "../../../domain/src/index.js";
import type { LearnerStateMemoryReadRepository } from "../../../domain/src/index.js";
import type { AgentSseEvent } from "../agents/core/types.js";
import { runMaterialFollowUpAgent } from "../agents/material-follow-up/runner.js";
import { buildReferencePromptSection } from "../citations/inline-citations.js";
import {
  anchorContextSnippet,
  parseFollowUpMessages,
  parseMaterialAnchor,
  type FollowUpMessage,
  type MaterialAnchor,
} from "../domain/material-anchor.js";
import { getUnitModulePromptBlock } from "../goals/module-prompt-context.js";
import { resolveGoalTopicCategory } from "../goals/resolve-goal-topic-category.js";
import {
  getLanguagePromptInstruction,
  resolveGoalContentLanguage,
} from "../llm/content-language.js";
import { formatContentSourcesExcerptsForPrompt } from "../rag/content-sources.js";
import {
  formatLearnedKnowledgePrompt,
  retrieveLearnedKnowledge,
} from "../rag/learned-knowledge.js";
import {
  getAggregatedUnitMaterialContext,
  type AggregatedUnitMaterialContext,
} from "../sections/index.js";
import { parseJson } from "../utils.js";
import { requireMaterialFollowUpPersistence } from "./material-follow-up-persistence.js";

export async function listMaterialFollowUps(userId: string, unitId: string) {
  const rows =
    (await requireMaterialFollowUpPersistence().listForUnit(userId, unitId)) ??
    [];
  return rows.map((row) => ({
    id: row.id,
    unitId: row.unitId,
    anchor: parseMaterialAnchor(parseJson(row.anchor, null)) ?? {
      scope: "block" as const,
    },
    messages: parseFollowUpMessages(parseJson(row.messages, [])),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function listRecentMaterialFollowUps(userId: string, limit = 50) {
  const rows = await requireMaterialFollowUpPersistence().listRecent(
    userId,
    Math.min(Math.max(limit, 1), 100),
  );

  return rows.map((row) => {
    const messages = parseFollowUpMessages(parseJson(row.messages, []));
    const latestQuestion = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    return {
      id: row.id,
      unitId: row.unitId,
      unitTitle: row.unitTitle,
      goalId: row.goalId,
      goalTitle: row.goalTitle,
      questionPreview: latestQuestion?.content.trim() || "追问",
      messageCount: messages.length,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

export type ReplyMaterialFollowUpParams = {
  learningPosition?: LearningPosition;
  activeVisitId?: string;
  userId: string;
  unitId: string;
  unitTitle: string;
  goalId: string;
  goalTitle: string;
  threadId?: string;
  anchor: MaterialAnchor;
  /** Frozen, server-authored snippet for typed assistant follow-up threads. */
  anchorSnippet?: string;
  userMessage: string;
  /** Text from an assistant reply explicitly quoted for this turn. */
  quotedText?: string;
  traceId: string;
  materialContext?: AggregatedUnitMaterialContext;
  learnerStateMemoryRead?: LearnerStateMemoryReadRepository;
  signal?: AbortSignal;
  send: (event: AgentSseEvent) => Promise<void>;
};

export async function replyMaterialFollowUp(
  params: ReplyMaterialFollowUpParams,
): Promise<{ threadId: string; messages: FollowUpMessage[] }> {
  const materialContext =
    params.materialContext ??
    (await getAggregatedUnitMaterialContext(params.unitId, undefined));
  if (!materialContext) {
    throw new Error("请先生成学习正文");
  }
  const { material, contextSources: storedSources } = materialContext;
  const persistence = requireMaterialFollowUpPersistence();
  const unitContext = await persistence.findUnitContext(
    params.userId,
    params.unitId,
  );
  if (!unitContext || unitContext.goalId !== params.goalId)
    throw new Error("单元不存在");
  const goal = {
    id: unitContext.goalId,
    title: unitContext.goalTitle,
    contentLanguage: unitContext.contentLanguage,
    topicCategory: unitContext.topicCategory,
  };
  const lang = getLanguagePromptInstruction(
    goal
      ? resolveGoalContentLanguage(goal.contentLanguage, goal.title)
      : "zh-Hans",
  );
  const anchorSnippet =
    params.learningPosition?.anchorText ?? params.anchorSnippet ?? anchorContextSnippet(material, params.anchor);

  let threadId = params.threadId;
  let history: FollowUpMessage[] = [];

  if (threadId) {
    const existing = await persistence.findThread(
      params.userId,
      params.unitId,
      threadId,
    );
    if (existing) {
      history = parseFollowUpMessages(parseJson(existing.messages, []));
    }
  }

  const userMsg: FollowUpMessage = {
    role: "user",
    content: params.userMessage.trim(),
    createdAt: new Date().toISOString(),
    ...(params.quotedText?.trim()
      ? { quotedText: params.quotedText.trim().slice(0, 240) }
      : {}),
  };
  if (!userMsg.content) throw new Error("请输入问题");

  const ragContext = buildReferencePromptSection(
    formatContentSourcesExcerptsForPrompt(storedSources),
    storedSources,
  );
  const learned = await retrieveLearnedKnowledge(
    params.userId,
    `${params.unitTitle}: ${userMsg.content}`,
    { k: 4, excludeUnitId: params.unitId },
  );
  const combinedContext = [
    ragContext,
    formatLearnedKnowledgePrompt(learned.context),
  ]
    .filter(Boolean)
    .join("\n\n");

  const { formatGlobalLearnerStateMemoryPrompt } =
    await import("../learner-state-memory/index.js");
  const { formatLearnerProfilePromptBlock, getLearnerProfile } =
    await import("../persona/learner-profile.js");
  const { formatCognitiveStatePromptBlock } =
    await import("../cognition/context.js");
  const [globalStateMemoryBlock, learnerProfile, goalStateBlock] =
    await Promise.all([
      formatGlobalLearnerStateMemoryPrompt(
        params.userId,
        undefined,
        params.learnerStateMemoryRead,
      ),
      getLearnerProfile(params.userId),
      formatCognitiveStatePromptBlock(params.userId, goal?.id),
    ]);
  const learnerContextBlock = [
    formatLearnerProfilePromptBlock(learnerProfile),
    globalStateMemoryBlock,
    goalStateBlock,
  ]
    .filter(Boolean)
    .join("\n\n");
  const moduleContext = await getUnitModulePromptBlock(params.unitId);

  const learningGuidance = await beginLearningGuidanceTurn({
    userId: params.userId, unitId: params.unitId, threadId: params.threadId, eventId: params.traceId,
    position: params.learningPosition ?? { version: 1, unitId: params.unitId, sectionId: params.anchor.sectionId, mode: "reading", anchorText: anchorSnippet },
    sourceText: userMsg.content, activeVisitId: params.activeVisitId,
  });
  const learningGuidanceContext = learningGuidance ? await guidanceContext(learningGuidance) : "";
  const agentResult = await runMaterialFollowUpAgent({
    learningGuidance,
    userId: params.userId,
    goalId: params.goalId,
    unitId: params.unitId,
    unitTitle: params.unitTitle,
    goalTitle: params.goalTitle || goal?.title || "当前学习目标",
    anchorSnippet,
    history,
    userMessage: userMsg.content,
    quotedText: userMsg.quotedText,
    lang,
    contentLanguage: goal?.contentLanguage ?? undefined,
    topicCategory: goal ? resolveGoalTopicCategory(goal) : undefined,
    ragContext: combinedContext,
    sourceCount: storedSources.length,
    sources: storedSources.length > 0 ? storedSources : undefined,
    // Teaching persona is loaded by teaching.persona.follow_up.v1. Keeping it
    // out of this invocation payload avoids duplicating the same guidance in
    // an earlier, turn-specific prompt block.
    learnerMemoryBlock: learnerContextBlock,
    moduleContext: [moduleContext, learningGuidanceContext].filter(Boolean).join("\n\n"),
    traceId: params.traceId,
    signal: params.signal,
    send: params.send,
  });

  const assistantMsg: FollowUpMessage = {
    role: "assistant",
    content: agentResult.content,
    createdAt: new Date().toISOString(),
    ...(agentResult.sources && agentResult.sources.length > 0
      ? { sources: agentResult.sources }
      : {}),
    ...(agentResult.toolUi ? { toolUi: agentResult.toolUi } : {}),
    ...(agentResult.knowledgeActivity
      ? { knowledgeActivity: agentResult.knowledgeActivity }
      : {}),
  };

  const messages = [...history, userMsg, assistantMsg];

  threadId =
    (await persistence.saveConversation({
      userId: params.userId,
      unitId: params.unitId,
      threadId,
      threadStateJson: JSON.stringify({
        llmMessages: [],
        conversationContext: {
          kind: "material_follow_up",
          goalId: params.goalId,
          unitId: params.unitId,
          unitTitle: params.unitTitle,
          goalTitle: params.goalTitle,
          anchor: params.anchor,
          anchorSnippet,
          learningPosition: params.learningPosition,
          activeVisitId: params.activeVisitId,
        },
      }),
      anchor: JSON.stringify(params.anchor),
      messages: JSON.stringify(messages),
      userMessage: userMsg.content,
      userMetadata: JSON.stringify({
        conversationKind: "material_follow_up",
        ...(userMsg.quotedText
          ? {
              contextSnapshot: {
                pageKind: "unit",
                contextLabel: params.unitTitle,
                goalId: params.goalId,
                unitId: params.unitId,
                selectedText: userMsg.quotedText,
              },
            }
          : {}),
      }),
      userMessageCreatedAt: userMsg.createdAt,
      assistantMessage: assistantMsg.content,
      assistantMessageCreatedAt: assistantMsg.createdAt,
      assistantToolCalls: JSON.stringify(
        assistantMsg.toolUi
          ? [
              {
                id: assistantMsg.toolUi.toolCallId,
                name: assistantMsg.toolUi.toolName,
                args: assistantMsg.toolUi.args,
              },
            ]
          : [],
      ),
      assistantUiPayload: JSON.stringify(
        assistantMsg.toolUi
          ? {
              uiKind: assistantMsg.toolUi.uiKind,
              toolCallId: assistantMsg.toolUi.toolCallId,
              toolName: assistantMsg.toolUi.toolName,
              args: assistantMsg.toolUi.args,
            }
          : {},
      ),
      assistantMetadata: JSON.stringify({
        conversationKind: "material_follow_up",
        ...(assistantMsg.sources ? { sources: assistantMsg.sources } : {}),
        ...(assistantMsg.knowledgeActivity
          ? { knowledgeActivity: assistantMsg.knowledgeActivity }
          : {}),
      }),
    })) ?? undefined;
  if (!threadId) throw new Error("对话保存失败");

  return { threadId: threadId!, messages };
}

export async function deleteMaterialFollowUp(
  userId: string,
  unitId: string,
  threadId: string,
) {
  await requireMaterialFollowUpPersistence().delete(userId, unitId, threadId);
}
