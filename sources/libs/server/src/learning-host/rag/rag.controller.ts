import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseInterceptors,
} from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUserId } from "../../../../common/src/index.js";
import { RagService, type RagUploadFile } from "./rag.service.js";

@Controller("api/rag")
export class RagController {
  constructor(private readonly rag: RagService) {}

  @Post("ingest")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "files", maxCount: 20 },
        { name: "file", maxCount: 1 },
      ],
      { limits: { fileSize: 50 * 1024 * 1024 } },
    ),
  )
  ingest(
    @CurrentUserId() userId: string,
    @UploadedFiles()
    uploads: { files?: RagUploadFile[]; file?: RagUploadFile[] },
    @Body("goalId") goalId: string,
  ) {
    const files = uploads.files?.length ? uploads.files : (uploads.file ?? []);
    return this.rag.ingest(userId, goalId, files);
  }

  @Post("ingest/stream")
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: "files", maxCount: 20 },
        { name: "file", maxCount: 1 },
      ],
      { limits: { fileSize: 50 * 1024 * 1024 } },
    ),
  )
  async ingestStream(
    @CurrentUserId() userId: string,
    @UploadedFiles()
    uploads: { files?: RagUploadFile[]; file?: RagUploadFile[] },
    @Body("goalId") goalId: string,
    @Res() response: Response,
  ) {
    const files = uploads.files?.length ? uploads.files : (uploads.file ?? []);
    response.status(200);
    response.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders();

    const write = (event: unknown) => {
      response.write(`${JSON.stringify(event)}\n`);
    };

    try {
      const result = await this.rag.ingest(userId, goalId, files, (message) =>
        write({ type: "progress", message }),
      );
      write({ type: "result", data: result });
    } catch (error) {
      const status =
        typeof (error as { getStatus?: unknown })?.getStatus === "function"
          ? (error as { getStatus: () => number }).getStatus()
          : 500;
      const message =
        error instanceof Error &&
        (process.env.XUELEARN_DESKTOP_LOCAL === "1" || status < 500)
          ? error.message
          : "Internal server error";
      write({ type: "error", status, message });
    } finally {
      response.end();
    }
  }

  @Get("documents/:documentId/content")
  async content(
    @CurrentUserId() userId: string,
    @Param("documentId") documentId: string,
    @Query("goalId") goalId: string,
    @Res() response: Response,
  ) {
    const original = await this.rag.getOriginal(userId, goalId, documentId);
    response.setHeader("Content-Type", original.contentType);
    response.setHeader("Content-Disposition", "inline");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.sendFile(original.path);
  }

  @Delete("documents/:documentId")
  deleteDocument(
    @CurrentUserId() userId: string,
    @Param("documentId") documentId: string,
    @Query("goalId") goalId: string,
  ) {
    return this.rag.deleteDocument(userId, goalId, documentId);
  }

  @Post("urls")
  ingestUrls(
    @CurrentUserId() userId: string,
    @Body() body: { goalId?: string; urls?: string[]; refresh?: boolean },
  ) {
    return this.rag.ingestUrls(
      userId,
      body.goalId ?? "",
      body.urls ?? [],
      body.refresh === true,
    );
  }
}
