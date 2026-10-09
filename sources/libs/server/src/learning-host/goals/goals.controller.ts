import { Body, Controller, Delete, Get, HttpException, Param, Patch, Post, Put, Query, Res, UploadedFiles, UseGuards, UseInterceptors } from "@nestjs/common";
import { FileFieldsInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CurrentUserId, decodeMultipartFilename, localizeBackendMessage, tBackend } from "../../../../common/src/index.js";
import { GoalsService } from "./goals.service.js";
import { pipeWebSseResponse } from "./sse.util.js";
function manualSseErrorMessage(error: unknown): string {
    if (!(error instanceof HttpException))
        return tBackend("error.internal");
    const response = error.getResponse();
    if (typeof response === "string")
        return localizeBackendMessage(response);
    if (response && typeof response === "object") {
        const raw = (response as {
            message?: unknown;
        }).message;
        if (typeof raw === "string")
            return localizeBackendMessage(raw);
        if (Array.isArray(raw)) {
            const messages = raw.filter((item): item is string => typeof item === "string");
            if (messages.length > 0) {
                return messages
                    .map((message) => localizeBackendMessage(message))
                    .join(", ");
            }
        }
    }
    return tBackend("error.unknown");
}
@Controller("api/goals")
export class GoalsController {
    constructor(private readonly goals: GoalsService) { }
    @Get()
    list(
    @CurrentUserId()
    userId: string) {
        return this.goals.listGoals(userId);
    }
    @Get("mini")
    async listMini(
    @CurrentUserId()
    userId: string) {
        const goals = await this.goals.listGoals(userId);
        return Array.isArray(goals)
            ? goals.filter((goal: {
                goalKind?: string;
            }) => goal.goalKind === "micro")
            : goals;
    }
    @Post("mini")
    createMini(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: Parameters<GoalsService["createGoal"]>[1]) {
        return this.goals.createMiniGoal(userId, body);
    }
    @Post()
    create(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: Parameters<GoalsService["createGoal"]>[1]) {
        return this.goals.createGoal(userId, body);
    }
    @Get(":goalId/foundation-goals")
    listFoundationGoals(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.listFoundationGoals(userId, goalId);
    }
    @Post(":goalId/learning-mode/mastery")
    enableGoalMastery(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.enableGoalMastery(userId, goalId);
    }
    /** Development-only endpoint; intentionally omitted from OpenAPI. */
    @Post(":goalId/internal/detach-kacom")
    detachKacomForInternalTesting(
    @Param("goalId")
    goalId: string) {
        return this.goals.detachKacomForInternalTesting(goalId);
    }
    @Post("decompose")
    async decompose(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: Parameters<GoalsService["decompose"]>[1]) {
        try {
            return await this.goals.decompose(userId, body);
        }
        catch (e) {
            throw new HttpException({ error: manualSseErrorMessage(e) }, 500);
        }
    }
    @Post("decompose/stream")
    async decomposeStream(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: Parameters<GoalsService["decomposeStream"]>[1], 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.decomposeStream(userId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                res.status(status).json({ error: manualSseErrorMessage(e) });
            }
        }
    }
    @Post("instant-micro/stream")
    @UseInterceptors(FileFieldsInterceptor([
        { name: "files", maxCount: 20 },
        { name: "file", maxCount: 1 },
    ]))
    async instantMicroStream(
    @CurrentUserId()
    userId: string, 
    @Body()
    body: {
        topic?: string;
        runId?: string;
    }, 
    @UploadedFiles()
    uploads: {
        files?: Express.Multer.File[];
        file?: Express.Multer.File[];
    } | undefined, 
    @Res()
    res: Response) {
        try {
            const rawFiles = uploads?.files?.length
                ? uploads.files
                : (uploads?.file ?? []);
            const files = rawFiles.map((file) => ({
                filename: decodeMultipartFilename(file.originalname),
                buffer: file.buffer,
            }));
            const webResponse = await this.goals.instantMicroStream(userId, body, files);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                res.status(status).json({ error: manualSseErrorMessage(e) });
            }
        }
    }
    @Post(":goalId/map/refresh/stream")
    async refreshMapStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["refreshMapStream"]>[2], 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.refreshMapStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                res.status(status).json({ error: manualSseErrorMessage(e) });
            }
        }
    }
    @Post(":goalId/map/stream")
    async mapStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Omit<Parameters<GoalsService["decomposeStream"]>[1], "goalId"> & {
        regenerate?: boolean;
        adjustment?: string;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.decomposeStream(userId, {
                ...body,
                goalId,
            });
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                res.status(status).json({ error: manualSseErrorMessage(e) });
            }
        }
    }
    @Delete(":goalId")
    delete(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.deleteGoal(userId, goalId);
    }
    @Get(":goalId/cognitive-model")
    getCognitiveModel(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Query("view")
    view?: string) {
        return this.goals.getCognitiveModel(userId, goalId, view === "atoms" || view === "constructs" ? view : "full");
    }
    @Get(":goalId/web-knowledge")
    async listWebKnowledge(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return {
            sources: await this.goals.listWebKnowledge(userId, goalId),
        };
    }
    @Post(":goalId/web-knowledge/:sourceId/refresh")
    refreshWebKnowledge(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("sourceId")
    sourceId: string) {
        return this.goals.refreshWebKnowledge(userId, goalId, sourceId);
    }
    @Delete(":goalId/web-knowledge/:sourceId")
    async deleteWebKnowledge(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("sourceId")
    sourceId: string) {
        await this.goals.deleteWebKnowledge(userId, goalId, sourceId);
        return { ok: true };
    }
    @Get(":goalId/mastery")
    getGoalMasterySummary(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.getGoalMasterySummary(userId, goalId);
    }
    @Get(":goalId/adaptive-assessment")
    getGoalAdaptiveAssessment(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.getGoalAdaptiveAssessment(userId, goalId);
    }
    @Get(":goalId/modules/:moduleId")
    getModule(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("moduleId")
    moduleId: string) {
        return this.goals.getModule(userId, goalId, moduleId);
    }
    @Get(":goalId/modules/:moduleId/cognitive-model")
    getModuleCognitiveModel(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("moduleId")
    moduleId: string, 
    @Query("view")
    view?: string) {
        return this.goals.getModuleCognitiveModel(userId, goalId, moduleId, view === "targets" || view === "full" ? view : "capabilities");
    }
    @Get(":goalId/modules/:moduleId/mastery")
    getModuleMasterySummary(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("moduleId")
    moduleId: string) {
        return this.goals.getModuleMasterySummary(userId, goalId, moduleId);
    }
    @Post(":goalId/modules/:moduleId/generation/retry")
    retryModuleGeneration(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("moduleId")
    moduleId: string) {
        return this.goals.retryModuleGeneration(userId, goalId, moduleId);
    }
    @Post(":goalId/modules/:moduleId/replan/stream")
    async replanLockedModules(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("moduleId")
    moduleId: string, 
    @Body()
    body: {
        adjustment?: string;
        runId?: string;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.replanLockedModules(userId, goalId, moduleId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (error) {
            if (error instanceof HttpException)
                throw error;
            throw error;
        }
    }
    @Get(":goalId")
    getGoal(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Query("view")
    view?: string) {
        return this.goals.getGoal(userId, goalId, view === "journey" ? "journey" : view === "compact" ? "compact" : "full");
    }
    @Post(":goalId/icon")
    ensureIcon(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.ensureGoalIcon(userId, goalId);
    }
    @Get(":goalId/plan")
    getPlan(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.getPlan(userId, goalId);
    }
    @Patch(":goalId/plan")
    patchPlan(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["patchPlan"]>[2]) {
        return this.goals.patchPlan(userId, goalId, body);
    }
    @Patch(":goalId/settings")
    patchGoalSettings(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["patchGoalSettings"]>[2]) {
        return this.goals.patchGoalSettings(userId, goalId, body);
    }
    @Post(":goalId/course-pattern/regenerate")
    regenerateGoalCoursePattern(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.regenerateGoalCoursePattern(userId, goalId);
    }
    @Post(":goalId/overview/stream")
    async overviewStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["overviewStream"]>[2], 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.overviewStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
    @Patch(":goalId/overview/units/:unitId")
    markOverviewUnitComplete(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("unitId")
    unitId: string, 
    @Body()
    body: Parameters<GoalsService["markOverviewUnitComplete"]>[3]) {
        return this.goals.markOverviewUnitComplete(userId, goalId, unitId, body);
    }
    @Post(":goalId/units")
    createGoalUnit(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["createBranchUnit"]>[2]) {
        return this.goals.createBranchUnit(userId, goalId, body);
    }
    @Patch(":goalId/units/reorder")
    reorderGoalUnits(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["reorderGoalUnits"]>[2]) {
        return this.goals.reorderGoalUnits(userId, goalId, body);
    }
    @Patch(":goalId/units/:unitId")
    updateGoalUnit(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("unitId")
    unitId: string, 
    @Body()
    body: Parameters<GoalsService["updateBranchUnit"]>[3]) {
        return this.goals.updateBranchUnit(userId, goalId, unitId, body);
    }
    @Delete(":goalId/units/:unitId")
    deleteGoalUnit(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Param("unitId")
    unitId: string) {
        return this.goals.deleteBranchUnit(userId, goalId, unitId);
    }
    @Patch(":goalId/summary")
    patchSummary(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: Parameters<GoalsService["patchSummary"]>[2]) {
        return this.goals.patchSummary(userId, goalId, body);
    }
    @Post(":goalId/summary")
    approveSummary(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.approveSummary(userId, goalId);
    }
    @Post(":goalId/summary/stream")
    async summaryStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: {
        hasUpload?: boolean;
        regenerate?: boolean;
        runId?: string;
        adjustment?: string;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.summaryStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
    @Post(":goalId/micro-unit/stream")
    async microUnitStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: {
        hasUpload?: boolean;
        runId?: string;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.microUnitStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
    @Post(":goalId/convert-to-full/stream")
    async convertMicroGoalToFullStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: {
        runId?: string;
        adjustment?: string;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.convertMicroGoalToFullStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
    @Post(":goalId/plan")
    approvePlan(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string) {
        return this.goals.approvePlan(userId, goalId);
    }
    @Post(":goalId/plan/stream")
    async planStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: {
        hasUpload?: boolean;
        regenerate?: boolean;
        runId?: string;
        adjustment?: string;
        planningMode?: "fast" | "deep" | "docs_first";
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.planStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
    @Post(":goalId/batch-sq/stream")
    async batchSqStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: {
        runId?: string;
        skipExisting?: boolean;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.batchSqStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
    @Post(":goalId/batch-material/stream")
    async batchMaterialStream(
    @CurrentUserId()
    userId: string, 
    @Param("goalId")
    goalId: string, 
    @Body()
    body: {
        runId?: string;
        unitIds?: string[];
        skipExisting?: boolean;
    }, 
    @Res()
    res: Response) {
        try {
            const webResponse = await this.goals.batchMaterialStream(userId, goalId, body);
            await pipeWebSseResponse(webResponse, res);
        }
        catch (e) {
            if (!res.headersSent) {
                const status = e instanceof HttpException ? e.getStatus() : 500;
                const payload = e instanceof HttpException
                    ? e.getResponse()
                    : { error: tBackend("error.unknown") };
                res
                    .status(status)
                    .json(typeof payload === "string" ? { error: payload } : payload);
            }
        }
    }
}
