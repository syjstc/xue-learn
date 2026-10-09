import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
} from "@nestjs/common";
import { CurrentUserId, tBackend } from "@xue-learn/core/common";
import { getEnv } from "@xue-learn/core/server/env";
import {
  LOCAL_RAG_MAX_CHUNKS_MAX,
  LOCAL_RAG_MAX_CHUNKS_MIN,
  localRuntimeSettingsSchema,
  readLocalRuntimeSettings,
  saveLocalRuntimeSettings,
} from "@xue-learn/core/server/rag/local-runtime-settings";

@Controller("api/local/resource-settings")
export class LocalResourceSettingsController {
  @Get()
  async get(@CurrentUserId() userId: string) {
    const stored = await readLocalRuntimeSettings(userId);
    return {
      ragMaxChunksPerUpload:
        stored.ragMaxChunksPerUpload ?? getEnv().RAG_MAX_CHUNKS_PER_UPLOAD,
      limits: {
        ragMaxChunksPerUpload: {
          min: LOCAL_RAG_MAX_CHUNKS_MIN,
          max: LOCAL_RAG_MAX_CHUNKS_MAX,
        },
      },
    };
  }

  @Patch()
  async patch(@CurrentUserId() userId: string, @Body() body: unknown) {
    const parsed = localRuntimeSettingsSchema.safeParse(body);
    if (!parsed.success || parsed.data.ragMaxChunksPerUpload === undefined) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.success ? undefined : parsed.error.flatten(),
      });
    }
    await saveLocalRuntimeSettings(userId, parsed.data);
    return this.get(userId);
  }
}
