import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import {
  createGeneralMemoryApplication,
  createMemoryPayloadSchema,
} from "../../learning-systems/capabilities/general-memory.js";
import { z } from "zod";

const listSchema = z
  .object({
    cursor: z.string().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
    kind: z
      .enum(["personal_fact", "preference", "constraint", "episode"])
      .optional(),
    status: z.enum(["active", "archived"]).optional(),
    scopeType: z.enum(["user", "goal", "thread"]).optional(),
    scopeId: z.string().min(1).nullable().optional(),
  })
  .strict();

const correctionSchema = z
  .object({
    summary: z.string().trim().min(1).max(2_000),
    importance: z.number().min(0).max(1).optional(),
  })
  .strict();
const resolutionSchema = z
  .object({ decision: z.enum(["accept", "reject"]) })
  .strict();

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

@Injectable()
export class MemoriesService {
  private application?: ReturnType<typeof createGeneralMemoryApplication>;

  private getApplication() {
    // Persistence is configured by LearningSpaceOrmProvider.onModuleInit().
    // Keep construction side-effect free and resolve this on the first
    // request, after Nest has completed module initialization.
    return (this.application ??= createGeneralMemoryApplication());
  }

  list(userId: string, query: Record<string, string | undefined>) {
    return this.getApplication().list({ userId, ...parse(listSchema, query) });
  }

  create(userId: string, body: unknown) {
    return this.getApplication().create({
      userId,
      ...parse(createMemoryPayloadSchema, body),
    });
  }

  async get(userId: string, id: string) {
    try {
      return await this.getApplication().get(userId, id);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async correct(userId: string, id: string, body: unknown) {
    try {
      return await this.getApplication().correct({
        userId,
        memoryId: id,
        ...parse(correctionSchema, body),
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  async archive(userId: string, id: string) {
    try {
      return await this.getApplication().archive(userId, id);
    } catch (error) {
      this.rethrow(error);
    }
  }

  async remove(userId: string, id: string) {
    try {
      await this.getApplication().delete(userId, id);
      return { deleted: true };
    } catch (error) {
      this.rethrow(error);
    }
  }

  listCandidates(userId: string, status = "needs_review") {
    if (status !== "needs_review") {
      throw new BadRequestException(tBackend("error.memory.reviewStatusOnly"));
    }
    return this.getApplication().listCandidates(userId);
  }

  async resolveCandidate(userId: string, id: string, body: unknown) {
    try {
      const { decision } = parse(resolutionSchema, body);
      return await this.getApplication().resolveCandidate({
        userId,
        candidateId: id,
        decision,
      });
    } catch (error) {
      this.rethrow(error);
    }
  }

  private rethrow(error: unknown): never {
    if (
      error instanceof Error &&
      /not found|unavailable/i.test(error.message)
    ) {
      throw new NotFoundException(error.message);
    }
    if (error instanceof BadRequestException) throw error;
    throw new BadRequestException(
      error instanceof Error ? error.message : "Invalid memory request",
    );
  }
}
