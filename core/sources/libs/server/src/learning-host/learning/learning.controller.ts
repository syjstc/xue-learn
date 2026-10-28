import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import type { Request, Response } from "express";
import { CurrentUserId } from "../../../../common/src/index.js";
import { normalizeUnitContentRevision } from "../../unit-session/application.js";
import { LearningService } from "./learning.service.js";
import { pipeWebSseResponse } from "./sse.util.js";

function requestSignal(req: Request): AbortSignal {
  return (
    (req as Request & { signal?: AbortSignal }).signal ??
    new AbortController().signal
  );
}

function requestedDerivationFormat(value: unknown): "teaching_v1" | undefined {
  return value === "teaching_v1" ? "teaching_v1" : undefined;
}

@Controller("api/units/:unitId")
export class LearningController {
  constructor(private readonly learning: LearningService) {}

  @Get("page")
  getUnitPage(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Query("goalId") goalId?: string,
  ) {
    return this.learning.getUnitPage(userId, unitId, goalId);
  }

  @Get("content")
  getUnitContent(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Query("revision") revision?: string,
  ) {
    const parsed = normalizeUnitContentRevision(revision);
    return this.learning.getUnitContent(userId, unitId, parsed);
  }

  @Get("sections")
  getSections(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getUnitSections(userId, unitId);
  }

  @Get("chat-audio")
  getChatAudioCatalog(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Query("sectionId") sectionId?: string,
  ) {
    return this.learning.listChatAudio(userId, unitId, sectionId);
  }

  @Post("chat-audio/ensure")
  @HttpCode(HttpStatus.ACCEPTED)
  ensureChatAudio(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body?: { sectionId?: string },
  ) {
    return this.learning.ensureChatAudio(userId, unitId, body?.sectionId);
  }

  @Get("chat-audio/:audioId")
  async getChatAudio(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("audioId") audioId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const audio = await this.learning.readChatAudio(userId, unitId, audioId);
    if (!audio) {
      res.status(404).json({ error: tBackend("error.media.invalidAudioId") });
      return;
    }
    const range = req.headers.range;
    res.setHeader("Content-Type", audio.mimeType);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "private, max-age=3600");
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2]
          ? Math.min(Number(match[2]), audio.body.length - 1)
          : audio.body.length - 1;
        if (start <= end && start < audio.body.length) {
          res.status(206);
          res.setHeader(
            "Content-Range",
            `bytes ${start}-${end}/${audio.body.length}`,
          );
          res.setHeader("Content-Length", end - start + 1);
          res.end(audio.body.subarray(start, end + 1));
          return;
        }
      }
      res.status(416);
      res.setHeader("Content-Range", `bytes */${audio.body.length}`);
      res.end();
      return;
    }
    res.setHeader("Content-Length", audio.body.length);
    res.end(audio.body);
  }

  @Get("sections/:sectionId/content")
  getSectionContent(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
    @Query("revision") revision?: string,
  ) {
    const parsed = normalizeUnitContentRevision(revision);
    return this.learning.getUnitSectionContent(
      userId,
      unitId,
      sectionId,
      parsed,
    );
  }

  @Post("sections/:sectionId/generate")
  generateSection(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
    @Req() req: Request,
    @Body()
    body?: {
      force?: boolean;
      topicId?: string;
      topicIndex?: number;
      derivationFormat?: "classic" | "teaching_v1";
    },
  ) {
    return this.learning.generateUnitSection(
      userId,
      unitId,
      sectionId,
      requestSignal(req),
      body?.force === true,
      body?.force === true
        ? undefined
        : {
            topicId: body?.topicId,
            topicIndex: body?.topicIndex,
          },
      requestedDerivationFormat(body?.derivationFormat),
    );
  }

  @Post("sections/:sectionId/generate/stream")
  async generateSectionStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
    @Res() res: Response,
    @Body()
    body?: {
      force?: boolean;
      topicId?: string;
      topicIndex?: number;
      derivationFormat?: "classic" | "teaching_v1";
    },
  ) {
    // Section authoring is a durable JIT job. A route update, transient
    // disconnect, or remounted SSE consumer must not be interpreted as the
    // learner pressing Stop. Explicit cancellation still goes through the
    // dedicated /generate/cancel endpoint, which aborts the registered lease.
    const webRes = this.learning.generateUnitSectionStream(
      userId,
      unitId,
      sectionId,
      undefined,
      body?.force === true,
      body?.force === true
        ? undefined
        : {
            topicId: body?.topicId,
            topicIndex: body?.topicIndex,
          },
      requestedDerivationFormat(body?.derivationFormat),
    );
    await pipeWebSseResponse(webRes, res);
  }

  @Get("sections/:sectionId/teaching-presentation/pending")
  pendingTeachingPresentation(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
  ) {
    return this.learning.pendingTeachingPresentation(userId, unitId, sectionId);
  }
  @Post("sections/:sectionId/teaching-presentation/accept")
  acceptTeachingPresentation(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
    @Body() body: { revision: number; hash: string },
  ) {
    if (!Number.isInteger(body?.revision) || typeof body?.hash !== "string")
      throw new BadRequestException("Invalid presentation revision");
    return this.learning.acceptTeachingPresentation(
      userId,
      unitId,
      sectionId,
      body.revision,
      body.hash,
    );
  }
  @Post("sections/:sectionId/teaching-presentation/stream")
  async teachingPresentationStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
    @Res() res: Response,
    @Body() body: { expectedRevision: number; action: "enhance" | "restore" },
  ) {
    if (
      !Number.isInteger(body?.expectedRevision) ||
      body.expectedRevision < 0 ||
      !["enhance", "restore"].includes(body.action)
    )
      throw new BadRequestException("Invalid presentation request");
    await pipeWebSseResponse(
      this.learning.teachingPresentationStream(
        userId,
        unitId,
        sectionId,
        body.expectedRevision,
        body.action,
      ),
      res,
    );
  }

  @Post("sections/:sectionId/generate/cancel")
  cancelSectionGeneration(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
  ) {
    return this.learning.cancelUnitSectionGeneration(userId, unitId, sectionId);
  }

  @Post("sections/:sectionId/complete")
  completeSection(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
  ) {
    return this.learning.completeUnitSection(userId, unitId, sectionId);
  }

  @Post("sections/:sectionId/skip")
  skipSection(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("sectionId") sectionId: string,
  ) {
    return this.learning.completeUnitSection(userId, unitId, sectionId, true);
  }

  @Get("session")
  getSession(@CurrentUserId() userId: string, @Param("unitId") unitId: string) {
    return this.learning.getSession(userId, unitId);
  }

  @Get("learning-access")
  getLearningAccess(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getLearningAccess(userId, unitId);
  }

  @Get("learning-targets")
  getLearningTargets(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getLearningTargets(userId, unitId);
  }

  @Get("concept-map")
  getConceptMap(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getUnitConceptMap(userId, unitId);
  }

  @Post("learning-targets/expand/stream")
  async expandLearningTargets(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.learningTargetExpansionStream(
      userId,
      unitId,
    );
    await pipeWebSseResponse(webRes, res);
  }

  @Get("diagnostic")
  getDiagnostic(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getDiagnostic(userId, unitId);
  }

  @Get("adaptive-assessment")
  getAdaptiveAssessment(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getUnitAdaptiveAssessment(userId, unitId);
  }

  @Post("diagnostic/stream")
  async diagnosticStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.sessionStream(userId, unitId, {
      ...body,
      action: "generate_diagnostic",
    });
    await pipeWebSseResponse(webRes, res);
  }

  @Post("diagnostic/:attemptId/submit")
  submitDiagnostic(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("attemptId") attemptId: string,
    @Body()
    body: {
      answers?: Record<string, string | number | boolean | number[]>;
    },
  ) {
    return this.learning.submitDiagnostic(
      userId,
      unitId,
      attemptId,
      body.answers ?? {},
    );
  }

  @Post("session")
  postSession(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: { action: string; payload?: Record<string, unknown> },
  ) {
    return this.learning.postSession(userId, unitId, body);
  }

  @Post("session/stream")
  async sessionStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.sessionStream(userId, unitId, body);
    await pipeWebSseResponse(webRes, res);
  }

  @Post("subdivide")
  async subdivide(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.subdivideStream(userId, unitId, body);
    await pipeWebSseResponse(webRes, res);
  }

  @Get("subdivision")
  getSubdivisionStatus(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getSubdivisionStatus(userId, unitId);
  }

  @Post("subdivide/regenerate")
  async regenerateSubMap(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.regenerateSubMapStream(
      userId,
      unitId,
      body,
    );
    await pipeWebSseResponse(webRes, res);
  }

  @Post("subdivide/remove")
  removeSubMap(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.removeSubMap(userId, unitId);
  }

  @Get("follow-ups")
  getFollowUps(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getFollowUps(userId, unitId);
  }

  @Get("quiz-sets")
  getQuizSets(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getQuizSets(userId, unitId);
  }

  @Get("flashcards")
  getFlashcards(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.getUnitFlashcards(userId, unitId);
  }

  @Post("flashcards/generate")
  generateFlashcards(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
  ) {
    return this.learning.generateUnitFlashcards(userId, unitId);
  }

  @Post("follow-ups")
  postFollowUps(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.learning.postFollowUps(userId, unitId, body);
  }

  @Post("illustrations/:blockIndex/regenerate")
  regenerateIllustration(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Body() body?: { prompt?: string; figureIndex?: number },
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    return this.learning.regenerateIllustration(
      userId,
      unitId,
      blockIndex,
      body?.prompt,
      body?.figureIndex,
    );
  }

  @Post("illustrations/:blockIndex/regenerate/stream")
  async regenerateIllustrationStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Body() body: { prompt?: string; figureIndex?: number } | undefined,
    @Res() res: Response,
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    await pipeWebSseResponse(
      this.learning.regenerateIllustrationStream(
        userId,
        unitId,
        blockIndex,
        body?.prompt,
        body?.figureIndex,
      ),
      res,
    );
  }

  @Post("components/:blockIndex/replace-with-illustration")
  replaceSvgWithIllustration(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    return this.learning.replaceSvgWithIllustration(userId, unitId, blockIndex);
  }

  @Post("components/:blockIndex/replace-with-illustration/stream")
  async replaceSvgWithIllustrationStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Res() res: Response,
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    await pipeWebSseResponse(
      this.learning.replaceSvgWithIllustrationStream(
        userId,
        unitId,
        blockIndex,
      ),
      res,
    );
  }

  @Post("components/:blockIndex/ai-edit")
  editComponentWithAi(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Body() body: { instruction?: string },
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    return this.learning.editComponentWithAi(
      userId,
      unitId,
      blockIndex,
      body?.instruction ?? "",
    );
  }

  @Delete("components/:blockIndex")
  deleteComponentBlock(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    return this.learning.deleteComponentBlock(userId, unitId, blockIndex);
  }

  @Post("components/:blockIndex/ai-edit/stream")
  async editComponentWithAiStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Body() body: { instruction?: string },
    @Res() res: Response,
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    await pipeWebSseResponse(
      this.learning.editComponentWithAiStream(
        userId,
        unitId,
        blockIndex,
        body?.instruction ?? "",
      ),
      res,
    );
  }

  @Post("components/:blockIndex/regenerate")
  regenerateComponent(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Body() body?: { placeholderComponentType?: string },
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    return this.learning.regenerateComponent(
      userId,
      unitId,
      blockIndex,
      body?.placeholderComponentType,
    );
  }

  @Post("components/:blockIndex/regenerate/stream")
  async regenerateComponentStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("blockIndex") blockIndexParam: string,
    @Body() body: { placeholderComponentType?: string } | undefined,
    @Res() res: Response,
  ) {
    const blockIndex = Number.parseInt(blockIndexParam, 10);
    if (!Number.isFinite(blockIndex) || blockIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    await pipeWebSseResponse(
      this.learning.regenerateComponentStream(
        userId,
        unitId,
        blockIndex,
        body?.placeholderComponentType,
      ),
      res,
    );
  }

  @Post("lab/components/:itemIndex/regenerate")
  regenerateUnitLabItem(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("itemIndex") itemIndexParam: string,
  ) {
    const itemIndex = Number.parseInt(itemIndexParam, 10);
    if (!Number.isFinite(itemIndex) || itemIndex < 0) {
      throw new BadRequestException(
        tBackend("error.learning.invalidBlockIndex"),
      );
    }
    return this.learning.regenerateUnitLabItem(userId, unitId, itemIndex);
  }

  @Post("follow-ups/stream")
  async followUpsStream(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const webRes = await this.learning.followUpsStream(
      userId,
      unitId,
      body,
      requestSignal(req),
    );
    await pipeWebSseResponse(webRes, res);
  }
}
