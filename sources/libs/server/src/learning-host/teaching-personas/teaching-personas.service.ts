import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { getCurrentLocale, tBackend } from "../../../../common/src/index.js";
import { randomUUID } from "node:crypto";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
import {
  DEFAULT_TEACHING_PERSONA_REF,
  customRecordToPersona,
  getBuiltinTeachingPersona,
  listBuiltinTeachingPersonas,
  previewTeachingPersona,
  resolvePersonaPromptLocale,
  TEACHING_PERSONA_PREVIEW_SCENES,
  resolveTeachingPersona,
  teachingPersonaForResponse,
  teachingPersonaInstructionsSchema,
  type TeachingPersonaInstructions,
} from "../../teaching-personas/index.js";
import {
  hostedPublicTeachingPersonaRef,
  isDesktopOnlyBuiltinTeachingPersona,
} from "../../../../domain/src/index.js";
import { z } from "zod";

const avatarCodes = [
  "xiaohui_female",
  "xiaohui",
  "zhiheng_female",
  "zhiheng",
  "lixing_female",
  "lixing",
  "tuoye_female",
  "tuoye",
  "quzhi_female",
  "quzhi",
  "ruiyan_female",
  "ruiyan",
] as const;
const personaBodySchema = z
  .object({
    name: z.string().trim().min(1).max(24),
    avatarCode: z.enum(avatarCodes),
    tagline: z.string().trim().max(60).default(""),
    learnerAddress: z.string().trim().min(1).max(16).default("你"),
    instructions: teachingPersonaInstructionsSchema,
  })
  .strict();
const personaUpdateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(24).optional(),
    avatarCode: z.enum(avatarCodes).optional(),
    tagline: z.string().trim().max(60).optional(),
    learnerAddress: z.string().trim().min(1).max(16).optional(),
    instructions: teachingPersonaInstructionsSchema.optional(),
  })
  .strict();
const selectBodySchema = z.object({ personaRef: z.string().min(1) });
const goalSelectBodySchema = z.object({
  personaRef: z.string().min(1).nullable(),
});
const previewBodySchema = personaBodySchema.extend({
  instructions: teachingPersonaInstructionsSchema,
  previewScenes: z
    .array(z.enum(TEACHING_PERSONA_PREVIEW_SCENES))
    .min(1)
    .optional(),
});

function rejectUnsafeCustomInstruction(value: string) {
  const unsafe =
    /(system\s*prompt|ignore\s+(all\s+)?previous|jailbreak|忽略.{0,8}(指令|规则)|系统提示|越权|绕过.{0,8}(安全|限制))/i;
  if (unsafe.test(value))
    throw new BadRequestException(tBackend("error.persona.unsafeInstruction"));
  return value;
}

function validateInstructions(
  instructions: TeachingPersonaInstructions,
): TeachingPersonaInstructions {
  return {
    version: 2,
    base: rejectUnsafeCustomInstruction(instructions.base),
    ...(instructions.course
      ? { course: rejectUnsafeCustomInstruction(instructions.course) }
      : {}),
    ...(instructions.assessment
      ? {
          assessment: rejectUnsafeCustomInstruction(instructions.assessment),
        }
      : {}),
    ...(instructions.followUp
      ? { followUp: rejectUnsafeCustomInstruction(instructions.followUp) }
      : {}),
  };
}

@Injectable()
export class TeachingPersonasService {
  constructor(private readonly persistence: LearningSpaceOrmProvider) {}

  private async assertRef(userId: string, ref: string) {
    if (
      isDesktopOnlyBuiltinTeachingPersona(ref) &&
      process.env.XUELEARN_DESKTOP_LOCAL !== "1"
    ) {
      throw new BadRequestException(tBackend("error.persona.invalid"));
    }
    if (getBuiltinTeachingPersona(ref)) return;
    if (!ref.startsWith("custom:"))
      throw new BadRequestException(tBackend("error.persona.invalid"));
    const exists = (
      await this.persistence.teachingPersona.listByUserId(userId)
    ).some((persona) => persona.id === ref.slice(7));
    if (!exists)
      throw new BadRequestException(tBackend("error.persona.invalid"));
  }

  async list(userId: string, goalId?: string) {
    const promptLocale = resolvePersonaPromptLocale(getCurrentLocale());
    const [rows, settings, selected, goal] = await Promise.all([
      this.persistence.teachingPersona.listByUserId(userId),
      this.persistence.userSettings.findByUserId(userId),
      resolveTeachingPersona(userId, goalId, promptLocale),
      goalId
        ? this.persistence.learningGoal.findOwnedById(userId, goalId)
        : null,
    ]);
    const globalRef =
      process.env.XUELEARN_DESKTOP_LOCAL === "1"
        ? settings?.teachingPersonaRef || DEFAULT_TEACHING_PERSONA_REF
        : hostedPublicTeachingPersonaRef(
            settings?.teachingPersonaRef || DEFAULT_TEACHING_PERSONA_REF,
          );
    return {
      current: teachingPersonaForResponse(selected, promptLocale),
      globalRef,
      goalPersonaRef: goal?.teachingPersonaRef
        ? process.env.XUELEARN_DESKTOP_LOCAL === "1"
          ? goal.teachingPersonaRef
          : hostedPublicTeachingPersonaRef(goal.teachingPersonaRef)
        : null,
      builtin: listBuiltinTeachingPersonas(promptLocale, {
        includeDesktopOnly: process.env.XUELEARN_DESKTOP_LOCAL === "1",
      }).map((p) => ({
        ...teachingPersonaForResponse(p, promptLocale),
        isSelectedGlobally: p.ref === globalRef,
      })),
      custom: rows.map(customRecordToPersona).map((p) => ({
        ...teachingPersonaForResponse(p, promptLocale),
        isSelectedGlobally: p.ref === globalRef,
      })),
    };
  }

  async create(userId: string, body: unknown) {
    const parsed = personaBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const data = {
      ...parsed.data,
      instructions: validateInstructions(parsed.data.instructions),
    };
    const row = await this.persistence.teachingPersona.create({
      id: randomUUID(),
      userId,
      name: data.name,
      avatarCode: data.avatarCode,
      tagline: data.tagline,
      learnerAddress: data.learnerAddress,
      instructionsJson: JSON.stringify(data.instructions),
    });
    return teachingPersonaForResponse(customRecordToPersona(row));
  }

  async preview(userId: string, body: unknown) {
    const parsed = previewBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const instructions = validateInstructions(parsed.data.instructions);
    const persona = {
      ...getBuiltinTeachingPersona(DEFAULT_TEACHING_PERSONA_REF)!,
      ref: "custom:preview",
      kind: "custom" as const,
      code: "preview",
      archetypeCode: null,
      editable: true,
      name: parsed.data.name,
      avatarCode: parsed.data.avatarCode,
      tagline: parsed.data.tagline,
      learnerAddress: parsed.data.learnerAddress,
      instructions,
    };
    return {
      samples: await previewTeachingPersona({
        userId,
        persona,
        scenes: parsed.data.previewScenes,
      }),
    };
  }

  async update(userId: string, id: string, body: unknown) {
    const parsed = personaUpdateBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    const data = {
      ...parsed.data,
      ...(parsed.data.instructions !== undefined
        ? {
            instructions: validateInstructions(parsed.data.instructions),
          }
        : {}),
    };
    const row = await this.persistence.teachingPersona.update(userId, id, {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.avatarCode !== undefined ? { avatarCode: data.avatarCode } : {}),
      ...(data.tagline !== undefined ? { tagline: data.tagline } : {}),
      ...(data.learnerAddress !== undefined
        ? { learnerAddress: data.learnerAddress }
        : {}),
      ...(data.instructions !== undefined
        ? { instructionsJson: JSON.stringify(data.instructions) }
        : {}),
    });
    if (!row) throw new NotFoundException(tBackend("error.persona.notFound"));
    return teachingPersonaForResponse(customRecordToPersona(row));
  }

  async remove(userId: string, id: string) {
    const removed =
      await this.persistence.teachingPersona.deleteAndClearReferences(
        userId,
        id,
        DEFAULT_TEACHING_PERSONA_REF,
      );
    if (!removed)
      throw new NotFoundException(tBackend("error.persona.notFound"));
    return { ok: true };
  }

  async selectGlobal(userId: string, body: unknown) {
    const parsed = selectBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    await this.assertRef(userId, parsed.data.personaRef);
    await this.persistence.userSettings.upsert({
      userId,
      patch: { teachingPersonaRef: parsed.data.personaRef },
    });
    return {
      persona: teachingPersonaForResponse(await resolveTeachingPersona(userId)),
    };
  }

  async selectGoal(userId: string, goalId: string, body: unknown) {
    const parsed = goalSelectBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: "INVALID_BODY",
        message: tBackend("error.request.invalidBody"),
        details: parsed.error.flatten(),
      });
    }
    if (parsed.data.personaRef)
      await this.assertRef(userId, parsed.data.personaRef);
    const result = await this.persistence.learningGoal.updateOwned(
      userId,
      goalId,
      { teachingPersonaRef: parsed.data.personaRef },
    );
    if (!result) throw new NotFoundException(tBackend("error.goal.notFound"));
    return {
      persona: teachingPersonaForResponse(
        await resolveTeachingPersona(userId, goalId),
      ),
      inherited: parsed.data.personaRef === null,
    };
  }
}
