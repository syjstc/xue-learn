import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { getAgendaForUser, getAgendaItemExplanation, getOrCreatePlanningSettings, patchPlanningSettings, refreshAgendaForUser } from "../../agenda/index.js";
import { tBackend } from "../../../../common/src/index.js";
import { localDateKey } from "../../agenda/timezone.js";
import { z } from "zod";
import { LearningSpaceOrmProvider } from "../../learning-spaces/learning-space-orm.provider.js";
const goalPrioritiesSchema = z.record(z.string().min(1), z.number().finite().min(0).max(100));
const patchSettingsSchema = z.object({
    enabled: z.boolean().optional(),
    timezone: z.string().trim().min(1).optional(),
    reminderEnabled: z.boolean().optional(),
    reminderHour: z.number().int().min(0).max(23).optional(),
    reminderMinute: z.number().int().min(0).max(59).optional(),
    dailyCapacityTargetMin: z.number().int().min(15).max(180).optional(),
    goalPriorities: goalPrioritiesSchema.optional(),
});
const refreshSchema = z.object({ force: z.boolean().optional() }).optional();
const todayCapacitySchema = z.object({
    minutes: z.number().int().min(15).max(180).nullable(),
});
function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success)
        throw new BadRequestException(parsed.error.flatten());
    return parsed.data;
}
@Injectable()
export class AgendaService {
    constructor(private readonly learningSpaceOrm: LearningSpaceOrmProvider) { }
    async getAgenda(userId: string, goalId?: string, spaceId?: string) {
        if (goalId && spaceId) {
            throw new BadRequestException(tBackend("error.agenda.scopeConflict"));
        }
        const goalIds = spaceId
            ? [
                ...(await this.learningSpaceOrm.service.goalIdsForSpace(userId, spaceId)),
            ]
            : undefined;
        return getAgendaForUser(userId, { goalId, goalIds, ensureFresh: true });
    }
    getSettings(userId: string) {
        return getOrCreatePlanningSettings(userId);
    }
    patchSettings(userId: string, body: unknown) {
        const patch = parseBody(patchSettingsSchema, body);
        return patchPlanningSettings(userId, patch);
    }
    async patchTodayCapacity(userId: string, body: unknown) {
        const { minutes } = parseBody(todayCapacitySchema, body);
        const settings = await getOrCreatePlanningSettings(userId);
        return patchPlanningSettings(userId, {
            todayCapacityOverrideMin: minutes,
            todayCapacityOverrideDate: minutes == null ? null : localDateKey(new Date(), settings.timezone),
        });
    }
    refresh(userId: string, body: unknown) {
        const parsed = parseBody(refreshSchema, body ?? {});
        return refreshAgendaForUser(userId, {
            reason: "manual",
            forceLlm: parsed?.force,
        });
    }
    async getItemExplanation(userId: string, id: string) {
        const item = await getAgendaItemExplanation(userId, id);
        if (!item)
            throw new NotFoundException(tBackend("error.agenda.itemNotFound"));
        return item;
    }
}
