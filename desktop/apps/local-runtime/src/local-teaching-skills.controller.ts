import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { CurrentUserId } from "@xue-learn/core/common";
import { readTeachingSkillZipEntries } from "@xue-learn/core/server/teaching-skills";
import { unzipSync } from "fflate";
import { TeachingSkillsService } from "@xue-learn/core/server/learning-host/teaching-skills/teaching-skills.service";

/** Private, fixed-owner skill management for desktop-local. */
@Controller("api/local/teaching-skills")
export class LocalTeachingSkillsController {
  constructor(private readonly skills: TeachingSkillsService) {}

  @Get()
  list() {
    return this.skills.list();
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.skills.get(id);
  }

  @Post("import")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  import(
    @CurrentUserId() localOwnerId: string,
    @UploadedFile() file?: { buffer: Buffer },
  ) {
    if (!file)
      throw new BadRequestException("A teaching skill ZIP is required");
    try {
      const archive = unzipSync(new Uint8Array(file.buffer));
      const files = readTeachingSkillZipEntries(archive);
      return this.skills.saveDraft(localOwnerId, { files });
    } catch {
      throw new BadRequestException("The teaching skill ZIP is invalid");
    }
  }

  @Post(":id/publish")
  publish(@Param("id") id: string) {
    return this.skills.publish(id);
  }

  @Post(":id/archive")
  archive(@Param("id") id: string) {
    return this.skills.archive(id);
  }
}
