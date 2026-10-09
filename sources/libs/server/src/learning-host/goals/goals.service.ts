import { BadRequestException, Injectable } from "@nestjs/common";
import { tBackend } from "../../../../common/src/index.js";
import type { GoalMapSummary } from "../../llm/schemas.js";
import { GoalCrudService } from "./goal-crud.service.js";
import { GoalMapUnitsService } from "./goal-map-units.service.js";
import { GoalDecomposeService } from "./goal-decompose.service.js";
import { GoalSummaryMicroService } from "./goal-summary-micro.service.js";
import { GoalPlanOverviewService } from "./goal-plan-overview.service.js";
import { GoalModulesService } from "./goal-modules.service.js";
import { deleteGoalWebKnowledgeSource, listGoalWebKnowledge, refreshGoalWebKnowledgeSource, WEB_KNOWLEDGE_PDF_REFRESH_UNSUPPORTED } from "../../search/web-knowledge.js";
@Injectable()
export class GoalsService {
    constructor(private readonly crud: GoalCrudService, private readonly mapUnits: GoalMapUnitsService, private readonly decomposeService: GoalDecomposeService, private readonly summaryMicro: GoalSummaryMicroService, private readonly planOverview: GoalPlanOverviewService, private readonly modules: GoalModulesService) { }
    listGoals(userId: string) {
        return this.crud.listGoals(userId);
    }
    ensureGoalIcon(userId: string, goalId: string) {
        return this.crud.ensureGoalIcon(userId, goalId);
    }
    createGoal(userId: string, body: {
        title: string;
        level?: string;
        generationOptions?: string;
    }) {
        return this.crud.createGoal(userId, body);
    }
    createMiniGoal(userId: string, body: Parameters<GoalsService["createGoal"]>[1]) {
        return this.summaryMicro.createMiniGoal(userId, body);
    }
    listFoundationGoals(userId: string, goalId: string) {
        return this.crud.listFoundationGoals(userId, goalId);
    }
    upgradeFoundationToMastery(userId: string, goalId: string) {
        return this.crud.upgradeFoundationToMastery(userId, goalId);
    }
    enableGoalMastery(userId: string, goalId: string) {
        return this.crud.enableGoalMastery(userId, goalId);
    }
    detachKacomForInternalTesting(goalId: string) {
        return this.crud.detachKacomForInternalTesting(goalId);
    }
    deleteGoal(userId: string, goalId: string) {
        return this.crud.deleteGoal(userId, goalId);
    }
    listWebKnowledge(userId: string, goalId: string) {
        return listGoalWebKnowledge(userId, goalId);
    }
    refreshWebKnowledge(userId: string, goalId: string, sourceId: string) {
        return refreshGoalWebKnowledgeSource(userId, goalId, sourceId).catch((error) => {
            if (error instanceof Error &&
                error.message === WEB_KNOWLEDGE_PDF_REFRESH_UNSUPPORTED) {
                throw new BadRequestException(tBackend("error.rag.pdfRefreshUnsupported"));
            }
            throw error;
        });
    }
    deleteWebKnowledge(userId: string, goalId: string, sourceId: string) {
        return deleteGoalWebKnowledgeSource(userId, goalId, sourceId);
    }
    async getGoal(userId: string, goalId: string, view: "full" | "compact" | "journey" = "compact") {
        if (view !== "journey") {
            return this.crud.getGoal(userId, goalId, view);
        }
        const [base, journey] = await Promise.all([
            this.crud.getGoal(userId, goalId, "compact"),
            this.modules.getJourney(userId, goalId),
        ]);
        return { goal: { ...base.goal, ...journey } };
    }
    getModule(userId: string, goalId: string, moduleId: string) {
        return this.modules.getModule(userId, goalId, moduleId);
    }
    getModuleCognitiveModel(userId: string, goalId: string, moduleId: string, view: "capabilities" | "targets" | "full") {
        return this.modules.getCognitiveModel(userId, goalId, moduleId, view);
    }
    getGoalMasterySummary(userId: string, goalId: string) {
        return this.crud.getMasterySummary(userId, goalId);
    }
    getGoalAdaptiveAssessment(userId: string, goalId: string) {
        return this.crud.getAdaptiveAssessment(userId, goalId);
    }
    getModuleMasterySummary(userId: string, goalId: string, moduleId: string) {
        return this.modules.getMasterySummary(userId, goalId, moduleId);
    }
    retryModuleGeneration(userId: string, goalId: string, moduleId: string) {
        return this.modules.retryGeneration(userId, goalId, moduleId);
    }
    replanLockedModules(userId: string, goalId: string, moduleId: string, body: {
        adjustment?: string;
        runId?: string;
    }) {
        return this.modules.replanLockedModules(userId, goalId, moduleId, body);
    }
    getCognitiveModel(userId: string, goalId: string, view: "atoms" | "constructs" | "full" = "full") {
        return this.crud.getCognitiveModel(userId, goalId, view);
    }
    createBranchUnit(userId: string, goalId: string, body: {
        title: string;
        contentSummary?: string;
        note?: string;
        parentUnitId?: string | null;
        unitKind?: string;
    }) {
        return this.mapUnits.createBranchUnit(userId, goalId, body);
    }
    updateBranchUnit(userId: string, goalId: string, unitId: string, body: {
        title?: string;
        contentSummary?: string;
        note?: string;
        parentUnitId?: string | null;
        orderIndex?: number;
    }) {
        return this.mapUnits.updateBranchUnit(userId, goalId, unitId, body);
    }
    reorderGoalUnits(userId: string, goalId: string, body: {
        parentUnitId?: string | null;
        orderedUnitIds?: string[];
    }) {
        return this.mapUnits.reorderGoalUnits(userId, goalId, body);
    }
    deleteBranchUnit(userId: string, goalId: string, unitId: string) {
        return this.mapUnits.deleteBranchUnit(userId, goalId, unitId);
    }
    decompose(userId: string, body: {
        title: string;
        level?: string;
        goalId?: string;
    }) {
        return this.decomposeService.decompose(userId, body);
    }
    decomposeStream(userId: string, body: {
        title: string;
        level?: string;
        goalId?: string;
        runId?: string;
        regenerate?: boolean;
        adjustment?: string;
    }) {
        return this.decomposeService.decomposeStream(userId, body);
    }
    refreshMapStream(userId: string, goalId: string, body: {
        runId?: string;
        parentUnitId?: string | null;
    } = {}) {
        return this.decomposeService.refreshMapStream(userId, goalId, body);
    }
    getPlan(userId: string, goalId: string) {
        return this.planOverview.getPlan(userId, goalId);
    }
    patchSummary(userId: string, goalId: string, body: Partial<GoalMapSummary>) {
        return this.summaryMicro.patchSummary(userId, goalId, body);
    }
    approveSummary(userId: string, goalId: string) {
        return this.summaryMicro.approveSummary(userId, goalId);
    }
    summaryStream(userId: string, goalId: string, body: {
        hasUpload?: boolean;
        regenerate?: boolean;
        runId?: string;
        adjustment?: string;
    } = {}) {
        return this.summaryMicro.summaryStream(userId, goalId, body);
    }
    microUnitStream(userId: string, goalId: string, body: {
        hasUpload?: boolean;
        runId?: string;
    } = {}) {
        return this.summaryMicro.microUnitStream(userId, goalId, body);
    }
    instantMicroStream(userId: string, body: {
        topic?: string;
        runId?: string;
    } = {}, files: Array<{
        filename: string;
        buffer: Buffer;
    }> = []) {
        return this.summaryMicro.instantMicroStream(userId, body, files);
    }
    convertMicroGoalToFullStream(userId: string, goalId: string, body: {
        runId?: string;
        adjustment?: string;
    } = {}) {
        return this.summaryMicro.convertMicroGoalToFullStream(userId, goalId, body);
    }
    patchGoalSettings(userId: string, goalId: string, body: {
        title?: string;
        contentLanguage?: string;
        coursePattern?: string;
    }) {
        return this.crud.patchGoalSettings(userId, goalId, body);
    }
    regenerateGoalCoursePattern(userId: string, goalId: string) {
        return this.crud.regenerateGoalCoursePattern(userId, goalId);
    }
    patchPlan(userId: string, goalId: string, body: {
        topicOverview?: string;
        outOfScope?: string[];
    }) {
        return this.planOverview.patchPlan(userId, goalId, body);
    }
    approvePlan(userId: string, goalId: string) {
        return this.planOverview.approvePlan(userId, goalId);
    }
    planStream(userId: string, goalId: string, body: {
        hasUpload?: boolean;
        regenerate?: boolean;
        runId?: string;
        adjustment?: string;
        planningMode?: "fast" | "deep" | "docs_first";
    } = {}) {
        return this.planOverview.planStream(userId, goalId, body);
    }
    batchSqStream(userId: string, goalId: string, body: {
        runId?: string;
        skipExisting?: boolean;
    } = {}) {
        return this.planOverview.batchSqStream(userId, goalId, body);
    }
    batchMaterialStream(userId: string, goalId: string, body: {
        runId?: string;
        unitIds?: string[];
        skipExisting?: boolean;
    } = {}) {
        return this.planOverview.batchMaterialStream(userId, goalId, body);
    }
    overviewStream(userId: string, goalId: string, body: {
        runId?: string;
    } = {}) {
        return this.planOverview.overviewStream(userId, goalId, body);
    }
    markOverviewUnitComplete(userId: string, goalId: string, unitId: string, body: {
        completed?: boolean;
    }) {
        return this.planOverview.markOverviewUnitComplete(userId, goalId, unitId, body);
    }
}
