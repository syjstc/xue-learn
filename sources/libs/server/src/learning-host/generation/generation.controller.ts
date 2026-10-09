import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { GenerationService } from "./generation.service.js";
import { ActiveRunsQueryDto } from "./dto/active-runs-query.dto.js";
import {
  CurrentUserId,
  localizeBackendMessage,
  localizeBackendPayload,
  tBackend,
} from "../../../../common/src/index.js";

@Controller('api/generation-runs')
export class GenerationController {
  constructor(private readonly generation: GenerationService) {}

  @Get('active')
  async listActive(
    @CurrentUserId() userId: string,
    @Query(new ValidationPipe({ transform: true })) query: ActiveRunsQueryDto,
  ) {
    const runs = await this.generation.listActiveRuns(
      userId,
      query.scope,
      query.scopeId,
    );

    return {
      runs: runs.map((r) => ({
        id: r.id,
        operation: r.operation,
        status: r.status,
        statusMessage: r.statusMessage
          ? localizeBackendMessage(r.statusMessage)
          : r.statusMessage,
        tokenPreview: r.tokenPreview,
        partialEvent: r.events[0]
          ? localizeBackendPayload(JSON.parse(r.events[0].payload))
          : null,
        createdAt: r.createdAt,
      })),
    };
  }

  @Get(':runId/stream')
  async stream(
    @CurrentUserId() userId: string,
    @Param('runId') runId: string,
    @Query('after') afterRaw: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    await this.generation.assertRunOwnedBy(runId, userId);
    const parsedAfter = Number.parseInt(afterRaw ?? '0', 10);
    const after = Number.isSafeInteger(parsedAfter) && parsedAfter > 0
      ? parsedAfter
      : 0;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    let disconnected = false;
    const onClose = () => {
      disconnected = true;
    };
    res.once('close', onClose);

    try {
      for await (const chunk of this.generation.streamRunEvents(runId, after)) {
        if (disconnected) break;
        if (!res.write(chunk)) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              res.off('drain', finish);
              res.off('close', finish);
              resolve();
            };
            res.once('drain', finish);
            res.once('close', finish);
          });
        }
      }
    } catch (e) {
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: e instanceof Error ? localizeBackendMessage(e.message) : tBackend('error.unknown'),
        })}\n\n`,
      );
    } finally {
      res.off('close', onClose);
      if (!disconnected && !res.writableEnded) res.end();
    }
  }

  @Post(':runId/cancel')
  async cancel(
    @CurrentUserId() userId: string,
    @Param('runId') runId: string,
  ) {
    const run = await this.generation.getGenerationRun(runId);
    if (!run) {
      throw new NotFoundException(tBackend('error.generation.notFound'));
    }
    await this.generation.assertRunOwnedBy(runId, userId);

    if (run.status !== 'running') {
      return { ok: true, status: run.status };
    }

    await this.generation.cancelGenerationRun(runId);
    return { ok: true, status: 'cancelled' };
  }
}
