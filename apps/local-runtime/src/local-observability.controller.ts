import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
} from "@nestjs/common";
import type {
  BackendErrorSource,
  BackendErrorStatusFilter,
} from "@xue-learn/core/server/observability";
import { tBackend } from "@xue-learn/core/common";
import { LlmLogsService } from "@xue-learn/core/server/learning-host/llm-logs/llm-logs.service";
import { BackendErrorsService } from "@xue-learn/core/server/learning-host/backend-errors/backend-errors.service";

const SOURCES = new Set<BackendErrorSource>(["api", "worker", "internal"]);

function parseSource(value?: string): BackendErrorSource | undefined {
  return value && SOURCES.has(value as BackendErrorSource)
    ? (value as BackendErrorSource)
    : undefined;
}

function parseStatus(value?: string): BackendErrorStatusFilter | undefined {
  if (value === "5xx") return value;
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 100 && parsed <= 599
    ? parsed
    : undefined;
}

/**
 * Single-owner observability reads for the loopback-only desktop runtime.
 *
 * These deliberately live below /api/local rather than weakening the hosted
 * admin guard or mounting the hosted /api/admin surface in the local product.
 */
@Controller("api/local/logs")
export class LocalObservabilityController {
  constructor(
    private readonly llmLogs: LlmLogsService,
    private readonly backendErrors: BackendErrorsService,
  ) {}

  private requireDevelopmentLogs(): void {
    if (process.env.XUELEARN_DESKTOP_DEV !== "1") {
      throw new NotFoundException();
    }
  }

  @Get("llm")
  async listLlmLogs(
    @Query("limit") limit?: string,
    @Query("page") page?: string,
    @Query("operation") operation?: string,
    @Query("kind") kind?: string,
    @Query("spanType") spanType?: string,
    @Query("status") status?: string,
    @Query("provider") provider?: string,
    @Query("traceId") traceId?: string,
    @Query("goalId") goalId?: string,
    @Query("scope") scope?: string,
    @Query("traceTimeline") traceTimeline?: string,
  ) {
    this.requireDevelopmentLogs();
    await this.llmLogs.recoverStaleRunning();
    return this.llmLogs.query({
      limit: limit ? Number(limit) : 50,
      page: page ? Number(page) : 1,
      operation,
      kind,
      spanType,
      status,
      provider,
      traceId,
      goalId,
      scope,
      traceTimeline: traceTimeline === "1" && Boolean(traceId),
    });
  }

  @Delete("llm")
  deleteLlmLogs() {
    this.requireDevelopmentLogs();
    return this.llmLogs.deleteAll();
  }

  @Get("llm/goals")
  llmLogGoals() {
    this.requireDevelopmentLogs();
    return this.llmLogs.queryGoals(50);
  }

  @Get("llm/traces")
  llmLogTraces(
    @Query("goalId") goalId?: string,
    @Query("limit") limit?: string,
  ) {
    this.requireDevelopmentLogs();
    return this.llmLogs.queryTraces(goalId, limit ? Number(limit) : 40);
  }

  @Get("llm/structured-reliability")
  structuredReliability(@Query("hours") hours?: string) {
    this.requireDevelopmentLogs();
    return this.llmLogs.queryStructuredReliability(hours ? Number(hours) : 24);
  }

  @Get("token-usage")
  tokenUsage(@Query("days") days?: string) {
    const parsed = days ? Number(days) : 30;
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3660) {
      throw new BadRequestException(tBackend("error.request.invalidBody"));
    }
    return this.llmLogs.queryLocalTokenUsage(parsed);
  }

  @Put("token-usage/pricing")
  saveTokenPricing(@Body() body: Record<string, unknown>) {
    const provider =
      typeof body.provider === "string" ? body.provider.trim() : "";
    const model = typeof body.model === "string" ? body.model.trim() : "";
    const values = [
      body.uncachedInputUsdPerMillion,
      body.cachedInputUsdPerMillion,
      body.outputUsdPerMillion,
    ].map(Number);
    if (!provider || !model || provider.length > 100 || model.length > 200) {
      throw new BadRequestException(tBackend("error.request.invalidBody"));
    }
    if (
      values.some(
        (value) => !Number.isFinite(value) || value < 0 || value > 1_000_000,
      )
    ) {
      throw new BadRequestException(tBackend("error.request.invalidBody"));
    }
    return this.llmLogs.saveLocalModelPricing({
      provider,
      model,
      uncachedInputUsdPerMillion: values[0]!,
      cachedInputUsdPerMillion: values[1]!,
      outputUsdPerMillion: values[2]!,
    });
  }

  @Delete("token-usage/pricing/:provider/:model")
  deleteTokenPricing(
    @Param("provider") provider: string,
    @Param("model") model: string,
  ) {
    return this.llmLogs.deleteLocalModelPricing(provider, model);
  }

  @Get("llm/goals/:goalId/usage")
  goalUsage(@Param("goalId") goalId: string) {
    this.requireDevelopmentLogs();
    return this.llmLogs.queryGoalUsage(goalId);
  }

  @Get("llm/:id")
  llmLogDetail(@Param("id") id: string) {
    this.requireDevelopmentLogs();
    return this.llmLogs.queryDetail(id);
  }

  @Get("errors")
  listBackendErrors(
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
    @Query("hours") hours?: string,
    @Query("source") source?: string,
    @Query("service") service?: string,
    @Query("status") status?: string,
    @Query("search") search?: string,
  ) {
    return this.backendErrors.list({
      limit: limit ? Number(limit) : undefined,
      cursor,
      hours: hours ? Number(hours) : undefined,
      source: parseSource(source),
      service,
      status: parseStatus(status),
      search,
    });
  }

  @Get("errors/:id")
  backendErrorDetail(@Param("id") id: string) {
    return this.backendErrors.detail(id);
  }
}
