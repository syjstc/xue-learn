import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { CurrentUserId, tBackend } from "@xue-learn/core/common";
import { LearningSpaceOrmProvider } from "@xue-learn/core/server/learning-spaces/learning-space-orm.provider";
import {
  isValidUnitImageId,
  readUnitImage,
} from "@xue-learn/core/server/images/storage";

/** Serve persisted unit illustrations without mounting hosted MediaModule/PDF. */
@Controller("api/units/:unitId/images")
export class LocalUnitImagesController {
  constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) {}

  @Get(":filename")
  async unitImage(
    @CurrentUserId() userId: string,
    @Param("unitId") unitId: string,
    @Param("filename") filename: string,
    @Res() res: Response,
  ) {
    if (!(await this.learningSpaceOrm.mediaAccess.ownsUnit(userId, unitId))) {
      throw new NotFoundException(tBackend("error.notFound"));
    }
    const imageId = filename.replace(/\.(png|jpg|jpeg|webp)$/i, "");
    if (!imageId || !isValidUnitImageId(imageId)) {
      throw new BadRequestException(tBackend("error.media.invalidImageId"));
    }
    const file = await readUnitImage(unitId, imageId);
    if (!file) {
      throw new NotFoundException(tBackend("error.notFound"));
    }
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(file.data);
  }
}
