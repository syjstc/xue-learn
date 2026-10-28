import { Injectable, NotFoundException } from '@nestjs/common';
import { tBackend } from "../../../../common/src/index.js";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import { STRUCTURED_OUTPUT_TIMEOUT_MS } from "../../llm/structured-contract.js";
import {
  queryGoalTokenUsage,
  queryLlmLogDetail,
  queryLlmLogs,
  queryLogGoals,
  queryLogTraces,
  queryStructuredReliability,
} from "../../llm/logs-query.js";

@Injectable()
export class LlmLogsService {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  async recoverStaleRunning() {
    const durationMs = STRUCTURED_OUTPUT_TIMEOUT_MS;
    return {
      recovered: await this.learningSpaceOrm.llmLogQuery.recoverRunningBefore({
        cutoff: new Date(Date.now() - durationMs),
        durationMs,
        error: 'The local LLM request exceeded its timeout or was interrupted',
      }),
    };
  }

  async query(params: {
    limit?: number;
    page?: number;
    operation?: string;
    kind?: string;
    spanType?: string;
    status?: string;
    provider?: string;
    traceId?: string;
    goalId?: string;
    scope?: string;
    traceTimeline?: boolean;
  }) {
    const result = await queryLlmLogs(this.learningSpaceOrm.llmLogQuery, {
      limit: params.limit ?? 50,
      page: params.page ?? 1,
      operation: params.operation,
      kind: params.kind,
      spanType: params.spanType,
      status: params.status,
      provider: params.provider,
      traceId: params.traceId,
      goalId: params.goalId,
      scope: params.scope,
      traceTimeline: params.traceTimeline,
    });

    return {
      ...result,
      logs: result.logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
        goalId: log.goalId,
        scope: log.scope,
        scopeId: log.scopeId,
      })),
    };
  }

  async deleteAll() {
    return { deleted: await this.learningSpaceOrm.llmLogQuery.deleteAll() };
  }

  async queryDetail(id: string) {
    const result = await queryLlmLogDetail(this.learningSpaceOrm.llmLogQuery, id);
    if (!result) {
      throw new NotFoundException(tBackend('error.notFound'));
    }
    return {
      log: {
        ...result.log,
        createdAt: result.log.createdAt.toISOString(),
      },
      childLogs: result.childLogs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
    };
  }

  async queryGoals(limit = 50) {
    const goals = await queryLogGoals(this.learningSpaceOrm.llmLogQuery, limit);
    return { goals };
  }

  async queryTraces(goalId?: string, limit = 40) {
    const traces = await queryLogTraces(this.learningSpaceOrm.llmLogQuery, goalId, limit);
    return { traces };
  }

  async queryGoalUsage(goalId: string) {
    const report = await queryGoalTokenUsage(this.learningSpaceOrm.llmLogQuery, goalId);
    if (!report) {
      throw new NotFoundException(tBackend('error.goal.notFound'));
    }
    return report;
  }

  queryStructuredReliability(hours = 24) {
    return queryStructuredReliability(this.learningSpaceOrm.llmLogQuery, hours);
  }

  queryLocalTokenUsage(days = 30) {
    return this.learningSpaceOrm.llmLogQuery.summarizeLocalTokenUsage(days);
  }

  async saveLocalModelPricing(input: {
    provider: string;
    model: string;
    uncachedInputUsdPerMillion: number;
    cachedInputUsdPerMillion: number;
    outputUsdPerMillion: number;
  }) {
    await this.learningSpaceOrm.llmLogQuery.upsertLocalModelPricing(input);
    return { saved: true };
  }

  async deleteLocalModelPricing(provider: string, model: string) {
    await this.learningSpaceOrm.llmLogQuery.deleteLocalModelPricing(
      provider,
      model,
    );
    return { deleted: true };
  }
}
