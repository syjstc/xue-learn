import { createHash, randomUUID } from "node:crypto";
import type {
  CreateLearningSpaceInput,
  CreateLearningGoalInput,
  LearningGoalRecord,
  LearningGoalRepository,
  LearningSpaceItemRelationRecord,
  LearningSpaceItemRelationRepository,
  LearningSpaceItemRepository,
  LearningSpaceItemRecord,
  LearningSpaceRecord,
  LearningSpaceRepository,
  LearningSpaceItemRelationType,
  LegacyMapReplacementRepository,
  MicroUnitPublicationRepository,
  OverviewCoursePublicationRepository,
  LearningGoalPlanRepository,
  LearningGoalSummaryRepository,
  ModuleStructureQueueRepository,
  SequentialCurriculumApprovalRepository,
  CognitiveModelInvalidationRepository,
  PlannedGoalBrief,
} from "../../../domain/src/index.js";
import { LearningSpaceError } from "./errors.js";
import { parsePlannedGoalBrief } from "./planned-goal-brief.js";

const RELATION_TYPES = [
  "prerequisite",
  "supports",
  "follow_up",
  "related",
] as const satisfies readonly LearningSpaceItemRelationType[];

export type LearningSpaceRepositories = Readonly<{
  spaces: LearningSpaceRepository;
  goals: LearningGoalRepository;
  items: LearningSpaceItemRepository;
  relations: LearningSpaceItemRelationRepository;
}>;

/** Narrow application boundary needed by goal creation; keeps orchestration mockable. */
export type LearningSpaceGoalCreationApplication = Pick<
  MikroOrmLearningSpaceApplicationService,
  | "createOwnedGoal"
  | "createForGoal"
  | "spaceIdForGoal"
  | "attachCreatedGoal"
  | "plannedGoalSeed"
  | "portfolio"
  | "applyOrganizationProposal"
> &
  Readonly<{
    legacyMapReplacement?: LegacyMapReplacementRepository;
    overviewCoursePublication?: OverviewCoursePublicationRepository;
    microUnitPublication?: MicroUnitPublicationRepository;
    learningGoalPlan?: LearningGoalPlanRepository;
    learningGoalSummary?: LearningGoalSummaryRepository;
    sequentialCurriculumApproval?: SequentialCurriculumApprovalRepository;
    moduleStructureQueue?: ModuleStructureQueueRepository;
    cognitiveModelInvalidation?: CognitiveModelInvalidationRepository;
  }>;

export type LearningSpaceApplication = LearningSpaceGoalCreationApplication &
  Pick<MikroOrmLearningSpaceApplicationService, "portfolio">;

export type LearningSpaceOrganizationProposal = Readonly<{
  fingerprint: string;
  createSpaces: readonly Readonly<{
    operationId: string;
    ref: string;
    name: string;
    purpose?: string;
  }>[];
  updateSpaces: readonly Readonly<{
    operationId: string;
    spaceId: string;
    name?: string;
    purpose?: string;
    reason?: string;
  }>[];
  moveGoals: readonly Readonly<{
    operationId: string;
    goalId: string;
    target: { spaceId?: string; spaceRef?: string };
    includeFoundationGoalIds?: readonly string[];
  }>[];
  reorderItems: readonly Readonly<{
    operationId: string;
    spaceId: string;
    orderedItemIds: readonly string[];
    reason?: string;
  }>[];
  plannedGoals: readonly Readonly<{
    operationId: string;
    ref: string;
    target: { spaceId?: string; spaceRef?: string };
    title: string;
    rationale?: string;
    suggestedGoalKind?: string;
    goalBrief?: PlannedGoalBrief;
  }>[];
  relations: readonly Readonly<{
    operationId: string;
    target: { spaceId?: string; spaceRef?: string };
    from: { itemId?: string; itemRef?: string; goalId?: string };
    to: { itemId?: string; itemRef?: string; goalId?: string };
    relationType: string;
  }>[];
}>;

export type LearningSpaceOrganizationApplication = Pick<
  MikroOrmLearningSpaceApplicationService,
  "applyOrganizationProposal"
>;

/**
 * Application composition supplies repositories for the active transaction.
 * The callback is deliberately repository-shaped, so this layer cannot
 * accidentally retain a Persistence client or an ORM transaction manager.
 */
export interface LearningSpaceOrganizationPersistence {
  readonly repositories: LearningSpaceRepositories;
  runInTransaction<T>(
    work: (repositories: LearningSpaceRepositories) => Promise<T>,
  ): Promise<T>;
}

function normalizeName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("und");
}

function cleanName(value: unknown): string {
  const name =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!name || name.length > 80) {
    throw new LearningSpaceError(
      "invalid_input",
      "Space name must be 1–80 characters.",
    );
  }
  return name;
}

function validatedGoalBrief(value: unknown): PlannedGoalBrief | null {
  if (value === undefined || value === null) return null;
  const brief = parsePlannedGoalBrief(value);
  if (!brief) {
    throw new LearningSpaceError(
      "invalid_input",
      "Invalid planned-goal brief.",
    );
  }
  return brief;
}

function cleanPurpose(value: unknown): string {
  const purpose = typeof value === "string" ? value.trim() : "";
  if (purpose.length > 500) {
    throw new LearningSpaceError(
      "invalid_input",
      "Space purpose must be at most 500 characters.",
    );
  }
  return purpose;
}

function cleanPlannedTitle(value: unknown): string {
  const title =
    typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (!title || title.length > 80) {
    throw new LearningSpaceError(
      "invalid_input",
      "Planned goal title must be 1–80 characters.",
    );
  }
  return title;
}

function relationType(value: unknown): LearningSpaceItemRelationType {
  if (
    typeof value === "string" &&
    (RELATION_TYPES as readonly string[]).includes(value)
  ) {
    return value as LearningSpaceItemRelationType;
  }
  throw new LearningSpaceError(
    "invalid_input",
    "Unsupported learning-space relation type.",
  );
}

function goalView(goal: LearningGoalRecord) {
  return {
    id: goal.id,
    title: goal.title,
    goalKind: goal.goalKind === "micro" ? "micro" : "full",
    status: goal.status,
    iconSvg: goal.iconSvg,
    iconTint: goal.iconTint,
    parentGoalId: goal.parentGoalId,
    goalRelationType: goal.goalRelationType,
    updatedAt: goal.updatedAt.toISOString(),
  };
}

function itemView(
  item: LearningSpaceItemRecord,
  goals: ReadonlyMap<string, LearningGoalRecord>,
) {
  const goal = item.itemType === "goal" ? goals.get(item.goalId) : undefined;
  return {
    id: item.id,
    spaceId: item.spaceId,
    itemType: item.itemType,
    goalId: item.goalId,
    plannedTitle: item.plannedTitle,
    rationale: item.rationale,
    suggestedGoalKind: item.suggestedGoalKind,
    goalBrief: item.itemType === "planned_goal" ? item.goalBrief : null,
    source: item.source,
    sortIndex: item.sortIndex,
    goal: goal ? goalView(goal) : null,
  };
}

function spaceView(
  space: LearningSpaceRecord,
  items: readonly LearningSpaceItemRecord[],
  relations: readonly LearningSpaceItemRelationRecord[],
  goals: ReadonlyMap<string, LearningGoalRecord>,
) {
  return {
    id: space.id,
    name: space.name,
    purpose: space.purpose,
    sortIndex: space.sortIndex,
    revision: space.revision,
    createdAt: space.createdAt.toISOString(),
    updatedAt: space.updatedAt.toISOString(),
    items: items.map((item) => itemView(item, goals)),
    relations: relations.map((relation) => ({
      id: relation.id,
      fromItemId: relation.fromItemId,
      toItemId: relation.toItemId,
      relationType: relation.relationType,
      source: relation.source,
    })),
  };
}

function nextSortIndex(items: readonly LearningSpaceItemRecord[]): number {
  return (
    (items.reduce((max, item) => Math.max(max, item.sortIndex), -1) ?? -1) + 1
  );
}

function structuralPortfolioFingerprint(fingerprint: string): string {
  if (fingerprint.startsWith("sha256:")) return fingerprint;
  const marker = "unorganized:";
  const markerIndex = fingerprint.lastIndexOf(marker);
  if (markerIndex < 0) return fingerprint;
  const prefix = fingerprint.slice(0, markerIndex + marker.length);
  const unorganizedGoalIds = fingerprint
    .slice(markerIndex + marker.length)
    .split(",")
    .filter(Boolean)
    .map((entry) =>
      entry.replace(
        /:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
        "",
      ),
    )
    .sort();
  return `${prefix}${unorganizedGoalIds.join(",")}`;
}

async function loadPortfolio(
  repositories: LearningSpaceRepositories,
  userId: string,
) {
  const { spaces, goals, items, relations } = repositories;
  const [spaceRows, goalRows] = await Promise.all([
    spaces.listByUserId(userId),
    goals.listOwned(userId),
  ]);
  const goalById = new Map(goalRows.map((goal) => [goal.id, goal]));
  const spaceData = await Promise.all(
    spaceRows.map(async (space) => ({
      space,
      items: await items.listBySpaceId(userId, space.id),
      relations: await relations.listBySpaceId(userId, space.id),
    })),
  );
  const organizedGoalIds = new Set(
    spaceData.flatMap(({ items: spaceItems }) =>
      spaceItems.flatMap((item) =>
        item.itemType === "goal" ? [item.goalId] : [],
      ),
    ),
  );
  const structuralFingerprint = [
    ...spaceData.map(
      ({ space, items: spaceItems, relations: spaceRelations }) =>
        JSON.stringify({
          id: space.id,
          revision: space.revision,
          items: spaceItems.map((item) => ({
            id: item.id,
            itemType: item.itemType,
            goalId: item.goalId,
            plannedTitle: item.plannedTitle,
            rationale: item.rationale,
            suggestedGoalKind: item.suggestedGoalKind,
            goalBrief: item.goalBrief ?? null,
            sortIndex: item.sortIndex,
          })),
          relations: spaceRelations.map((relation) => ({
            id: relation.id,
            fromItemId: relation.fromItemId,
            toItemId: relation.toItemId,
            relationType: relation.relationType,
          })),
        }),
    ),
    `unorganized:${goalRows
      .filter((goal) => !organizedGoalIds.has(goal.id))
      // Proposal operations address goals by identity. Goal-generation and
      // assistant-review workflows may update ordinary goal metadata (and
      // therefore updatedAt) without changing Learning Spaces organization.
      // Including that timestamp made an otherwise valid organization preview
      // stale even though its membership and operation targets were unchanged.
      .map((goal) => goal.id)
      .sort()
      .join(",")}`,
  ].join("|");
  const fingerprint = `sha256:${createHash("sha256")
    .update(structuralFingerprint)
    .digest("hex")}`;
  return {
    fingerprint,
    spaces: spaceData.map(
      ({ space, items: spaceItems, relations: spaceRelations }) =>
        spaceView(space, spaceItems, spaceRelations, goalById),
    ),
    unorganizedGoals: goalRows
      .filter((goal) => !organizedGoalIds.has(goal.id))
      .map(goalView),
  };
}

export class MikroOrmLearningSpaceApplicationService {
  constructor(
    private readonly persistence: LearningSpaceOrganizationPersistence,
    readonly legacyMapReplacement?: LegacyMapReplacementRepository,
    readonly overviewCoursePublication?: OverviewCoursePublicationRepository,
    readonly microUnitPublication?: MicroUnitPublicationRepository,
    readonly learningGoalPlan?: LearningGoalPlanRepository,
    readonly learningGoalSummary?: LearningGoalSummaryRepository,
    readonly sequentialCurriculumApproval?: SequentialCurriculumApprovalRepository,
    readonly moduleStructureQueue?: ModuleStructureQueueRepository,
    readonly cognitiveModelInvalidation?: CognitiveModelInvalidationRepository,
  ) {}

  async portfolio(userId: string) {
    return loadPortfolio(this.persistence.repositories, userId);
  }

  async detail(userId: string, spaceId: string) {
    const portfolio = await this.portfolio(userId);
    const space = portfolio.spaces.find(
      (candidate) => candidate.id === spaceId,
    );
    if (!space) {
      throw new LearningSpaceError("not_found", "Learning Space not found.");
    }
    return space;
  }

  async goalIdsForSpace(
    userId: string,
    spaceId: string,
  ): Promise<readonly string[]> {
    const items = await this.persistence.repositories.items.listBySpaceId(
      userId,
      spaceId,
    );
    return items.flatMap((item) =>
      item.itemType === "goal" ? [item.goalId] : [],
    );
  }

  /** Create an owned goal through the same repository/transaction boundary. */
  async createOwnedGoal(
    userId: string,
    input: Omit<CreateLearningGoalInput, "id" | "userId">,
  ): Promise<LearningGoalRecord> {
    return this.persistence.runInTransaction(async (repos) => {
      if (input.parentGoalId) {
        const parent = await repos.goals.findOwnedById(
          userId,
          input.parentGoalId,
        );
        if (!parent) {
          throw new LearningSpaceError(
            "ownership",
            "Parent learning goal not found.",
          );
        }
      }
      return repos.goals.create({
        ...input,
        id: randomUUID(),
        userId,
      });
    });
  }

  async spaceIdForGoal(userId: string, goalId: string): Promise<string | null> {
    return (
      (await this.persistence.repositories.items.findByGoalId(userId, goalId))
        ?.spaceId ?? null
    );
  }

  async plannedGoalSeed(
    userId: string,
    spaceId: string,
    itemId: string,
  ): Promise<{
    itemId: string;
    spaceId: string;
    title: string;
    rationale: string;
    suggestedGoalKind: "full" | "micro";
    goalBrief: PlannedGoalBrief | null;
  } | null> {
    const item = await this.persistence.repositories.items.findById(
      userId,
      itemId,
    );
    if (!item || item.itemType !== "planned_goal" || item.spaceId !== spaceId) {
      return null;
    }
    return {
      itemId: item.id,
      spaceId: item.spaceId,
      title: item.plannedTitle,
      rationale: item.rationale,
      suggestedGoalKind: item.suggestedGoalKind,
      goalBrief: item.goalBrief ?? null,
    };
  }

  async attachCreatedGoal(
    userId: string,
    goalId: string,
    input: { spaceId?: string; targetSpaceItemId?: string; source?: string },
  ) {
    if (!input.spaceId) {
      return { assigned: false, reason: "no_space" } as const;
    }

    return this.persistence.runInTransaction(async (repos) => {
      const spaces = await repos.spaces.listByUserId(userId);
      const space = spaces.find((candidate) => candidate.id === input.spaceId);
      if (!space) {
        return { assigned: false, reason: "space_missing" } as const;
      }

      const target = input.targetSpaceItemId
        ? await repos.items.findById(userId, input.targetSpaceItemId)
        : null;
      if (
        input.targetSpaceItemId &&
        (!target ||
          target.itemType !== "planned_goal" ||
          target.spaceId !== space.id)
      ) {
        return {
          assigned: false,
          reason: "target_missing",
          warning:
            "The planned roadmap item no longer exists; the goal was kept in the Default space.",
        } as const;
      }

      if (target) {
        const activated = await repos.items.activatePlannedGoalItem(
          userId,
          target.id,
          goalId,
          input.source ?? target.source,
        );
        if (!activated) {
          throw new LearningSpaceError(
            "ownership",
            "Learning goal could not be attached.",
          );
        }
        return {
          assigned: true,
          spaceId: space.id,
          reusedItem: true,
        } as const;
      }

      const items = await repos.items.listBySpaceId(userId, space.id);
      const created = await repos.items.createGoalItem({
        userId,
        id: randomUUID(),
        spaceId: space.id,
        goalId,
        source: input.source ?? "manual",
        sortIndex: nextSortIndex(items),
      });
      if (!created) {
        throw new LearningSpaceError(
          "ownership",
          "Learning goal could not be attached.",
        );
      }
      return {
        assigned: true,
        spaceId: space.id,
        reusedItem: false,
      } as const;
    });
  }

  async create(userId: string, input: { name: string; purpose?: string }) {
    const name = cleanName(input.name);
    const purpose = cleanPurpose(input.purpose);
    const created = await this.persistence.runInTransaction(async (repos) => {
      const spaces = await repos.spaces.listByUserId(userId);
      const normalizedName = normalizeName(name);
      if (spaces.some((space) => space.normalizedName === normalizedName)) {
        throw new LearningSpaceError(
          "duplicate_name",
          "A Learning Space with this name already exists.",
        );
      }
      const sortIndex =
        spaces.reduce((max, space) => Math.max(max, space.sortIndex), -1) + 1;
      const createInput: CreateLearningSpaceInput = {
        id: randomUUID(),
        userId,
        name,
        normalizedName,
        purpose,
        sortIndex,
        revision: 1,
      };
      return repos.spaces.create(createInput);
    });
    return this.detail(userId, created.id);
  }

  async update(
    userId: string,
    spaceId: string,
    input: { name?: string; purpose?: string },
  ) {
    const updated = await this.persistence.runInTransaction(async (repos) => {
      const current = await repos.spaces.listByUserId(userId);
      const space = current.find((candidate) => candidate.id === spaceId);
      if (!space) {
        throw new LearningSpaceError("not_found", "Learning Space not found.");
      }
      const patch: {
        revision: number;
        name?: string;
        normalizedName?: string;
        purpose?: string;
        sortIndex?: number;
      } = {
        revision: space.revision + 1,
      };
      if (input.name !== undefined) {
        const name = cleanName(input.name);
        const normalizedName = normalizeName(name);
        if (
          current.some(
            (candidate) =>
              candidate.id !== spaceId &&
              candidate.normalizedName === normalizedName,
          )
        ) {
          throw new LearningSpaceError(
            "duplicate_name",
            "A Learning Space with this name already exists.",
          );
        }
        Object.assign(patch, { name, normalizedName });
      }
      if (input.purpose !== undefined) {
        patch.purpose = cleanPurpose(input.purpose);
      }
      return repos.spaces.update(userId, spaceId, patch);
    });
    if (!updated) {
      throw new LearningSpaceError("not_found", "Learning Space not found.");
    }
    return this.detail(userId, updated.id);
  }

  async delete(userId: string, spaceId: string): Promise<{ ok: true }> {
    const deleted = await this.persistence.runInTransaction((repos) =>
      repos.spaces.delete(userId, spaceId),
    );
    if (!deleted) {
      throw new LearningSpaceError("not_found", "Learning Space not found.");
    }
    return { ok: true };
  }

  async reorderSpaces(userId: string, orderedSpaceIds: readonly string[]) {
    await this.persistence.runInTransaction(async (repos) => {
      const spaces = await repos.spaces.listByUserId(userId);
      const ids = new Set(spaces.map((space) => space.id));
      if (
        orderedSpaceIds.length !== ids.size ||
        new Set(orderedSpaceIds).size !== ids.size ||
        orderedSpaceIds.some((id) => !ids.has(id))
      ) {
        throw new LearningSpaceError(
          "invalid_order",
          "Space order must contain every owned space exactly once.",
        );
      }
      const byId = new Map(spaces.map((space) => [space.id, space]));
      for (const [sortIndex, id] of orderedSpaceIds.entries()) {
        const space = byId.get(id)!;
        const result = await repos.spaces.update(userId, id, {
          sortIndex,
          revision: space.revision + 1,
        });
        if (!result)
          throw new LearningSpaceError(
            "not_found",
            "Learning Space not found.",
          );
      }
    });
    return { ok: true } as const;
  }

  async createPlannedGoal(
    userId: string,
    spaceId: string,
    input: {
      title: string;
      rationale?: string;
      suggestedGoalKind?: string;
      source?: string;
      /** Internal idempotency identity for an approved learning-branch proposal. */
      requestId?: string;
      goalBrief?: PlannedGoalBrief;
    },
  ) {
    const created = await this.persistence.runInTransaction(async (repos) => {
      const existing = await repos.items.listBySpaceId(userId, spaceId);
      const existingRequest = input.requestId ? await repos.items.findById(userId, input.requestId) : undefined;
      if (existingRequest) return existingRequest;
      const item = await repos.items.createPlannedGoalItem({
        userId,
        id: input.requestId ?? randomUUID(),
        spaceId,
        plannedTitle: cleanPlannedTitle(input.title),
        rationale: cleanPurpose(input.rationale),
        suggestedGoalKind:
          input.suggestedGoalKind === "micro" ? "micro" : "full",
        goalBrief: validatedGoalBrief(input.goalBrief),
        source: input.source === "assistant" ? "assistant" : "manual",
        sortIndex: nextSortIndex(existing),
      });
      if (!item)
        throw new LearningSpaceError("not_found", "Learning Space not found.");
      return item;
    });
    return created;
  }

  async updatePlannedGoal(
    userId: string,
    itemId: string,
    input: {
      title?: string;
      rationale?: string;
      suggestedGoalKind?: string;
      goalBrief?: PlannedGoalBrief | null;
    },
  ) {
    const current = await this.persistence.repositories.items.findById(
      userId,
      itemId,
    );
    if (!current || current.itemType !== "planned_goal") {
      throw new LearningSpaceError("not_found", "Planned goal not found.");
    }
    const updated = await this.persistence.runInTransaction((repos) =>
      repos.items.updatePlannedGoalItem(userId, itemId, {
        ...(input.title !== undefined
          ? { plannedTitle: cleanPlannedTitle(input.title) }
          : {}),
        ...(input.rationale !== undefined
          ? { rationale: cleanPurpose(input.rationale) }
          : {}),
        ...(input.suggestedGoalKind !== undefined
          ? {
              suggestedGoalKind:
                input.suggestedGoalKind === "micro" ? "micro" : "full",
            }
          : {}),
        ...(input.goalBrief !== undefined
          ? { goalBrief: validatedGoalBrief(input.goalBrief) }
          : {}),
      }),
    );
    if (!updated)
      throw new LearningSpaceError("not_found", "Planned goal not found.");
    return updated;
  }

  async removeItem(userId: string, itemId: string) {
    const item = await this.persistence.repositories.items.findById(
      userId,
      itemId,
    );
    if (!item)
      throw new LearningSpaceError("not_found", "Roadmap item not found.");
    const deleted = await this.persistence.runInTransaction((repos) =>
      repos.items.delete(userId, itemId),
    );
    if (!deleted)
      throw new LearningSpaceError("not_found", "Roadmap item not found.");
    return { ok: true, goalPreserved: item.itemType === "goal" } as const;
  }

  async reorderItems(
    userId: string,
    spaceId: string,
    orderedItemIds: readonly string[],
  ) {
    const reordered = await this.persistence.runInTransaction((repos) =>
      repos.items.reorder(userId, spaceId, orderedItemIds),
    );
    if (!reordered) {
      throw new LearningSpaceError(
        "invalid_order",
        "Item order must contain every item in this space exactly once.",
      );
    }
    return { ok: true } as const;
  }

  async createRelation(
    userId: string,
    spaceId: string,
    input: {
      fromItemId: string;
      toItemId: string;
      relationType: string;
      source?: string;
    },
  ) {
    const created = await this.persistence.runInTransaction((repos) =>
      repos.relations.create({
        userId,
        id: randomUUID(),
        spaceId,
        fromItemId: input.fromItemId,
        toItemId: input.toItemId,
        relationType: relationType(input.relationType),
        source: input.source === "assistant" ? "assistant" : "manual",
      }),
    );
    if (!created) {
      throw new LearningSpaceError(
        "invalid_input",
        "Learning-space relation endpoints are invalid or unavailable.",
      );
    }
    return created;
  }

  async deleteRelation(userId: string, relationId: string) {
    const deleted = await this.persistence.runInTransaction((repos) =>
      repos.relations.delete(userId, relationId),
    );
    if (!deleted) {
      throw new LearningSpaceError(
        "not_found",
        "Roadmap relationship not found.",
      );
    }
    return { ok: true } as const;
  }

  async applyOrganizationProposal(
    userId: string,
    proposal: LearningSpaceOrganizationProposal,
    selectedOperationIds: readonly string[],
  ) {
    const knownOperationIds = new Set([
      ...proposal.createSpaces.map((operation) => operation.operationId),
      ...proposal.updateSpaces.map((operation) => operation.operationId),
      ...proposal.moveGoals.map((operation) => operation.operationId),
      ...proposal.reorderItems.map((operation) => operation.operationId),
      ...proposal.plannedGoals.map((operation) => operation.operationId),
      ...proposal.relations.map((operation) => operation.operationId),
    ]);
    const selected = new Set(selectedOperationIds);
    if (
      selected.size !== selectedOperationIds.length ||
      [...selected].some((id) => !knownOperationIds.has(id))
    ) {
      throw new LearningSpaceError(
        "invalid_input",
        "The selected organization operations are invalid.",
      );
    }

    return this.persistence.runInTransaction(async (repos) => {
      const current = await loadPortfolio(repos, userId);
      if (
        structuralPortfolioFingerprint(current.fingerprint) !==
        structuralPortfolioFingerprint(proposal.fingerprint)
      ) {
        throw new LearningSpaceError(
          "stale",
          "Your Learning Spaces changed after this preview was created. Please generate a fresh proposal.",
        );
      }
      const spaces = await repos.spaces.listByUserId(userId);
      const spacesById = new Map(spaces.map((space) => [space.id, space]));
      const createdSpaceByRef = new Map<string, string>();
      const createdItemByRef = new Map<string, string>();
      let nextSpaceSort =
        spaces.reduce((max, space) => Math.max(max, space.sortIndex), -1) + 1;

      for (const operation of proposal.createSpaces) {
        if (!selected.has(operation.operationId)) continue;
        const name = cleanName(operation.name);
        const normalizedName = normalizeName(name);
        if (
          [...spacesById.values()].some(
            (space) => space.normalizedName === normalizedName,
          )
        ) {
          throw new LearningSpaceError(
            "duplicate_name",
            `A Learning Space named “${name}” already exists.`,
          );
        }
        const created = await repos.spaces.create({
          id: randomUUID(),
          userId,
          name,
          normalizedName,
          purpose: cleanPurpose(operation.purpose),
          sortIndex: nextSpaceSort++,
          revision: 1,
        });
        createdSpaceByRef.set(operation.ref, created.id);
        spacesById.set(created.id, created);
      }

      for (const operation of proposal.updateSpaces) {
        if (!selected.has(operation.operationId)) continue;
        const currentSpace = spacesById.get(operation.spaceId);
        if (!currentSpace) {
          throw new LearningSpaceError(
            "ownership",
            "A proposed Learning Space is unavailable.",
          );
        }
        const name =
          operation.name === undefined ? undefined : cleanName(operation.name);
        const normalizedName =
          name === undefined ? undefined : normalizeName(name);
        if (
          normalizedName &&
          [...spacesById.values()].some(
            (space) =>
              space.id !== currentSpace.id &&
              space.normalizedName === normalizedName,
          )
        ) {
          throw new LearningSpaceError(
            "duplicate_name",
            `A Learning Space named “${name}” already exists.`,
          );
        }
        const updated = await repos.spaces.update(userId, currentSpace.id, {
          ...(name === undefined ? {} : { name, normalizedName }),
          ...(operation.purpose === undefined
            ? {}
            : { purpose: cleanPurpose(operation.purpose) }),
          revision: currentSpace.revision + 1,
        });
        if (!updated) {
          throw new LearningSpaceError(
            "ownership",
            "A proposed Learning Space is unavailable.",
          );
        }
        spacesById.set(updated.id, updated);
      }

      const resolveTarget = (target: {
        spaceId?: string;
        spaceRef?: string;
      }) => {
        const spaceId = target.spaceRef
          ? createdSpaceByRef.get(target.spaceRef)
          : target.spaceId;
        const space = spaceId ? spacesById.get(spaceId) : undefined;
        if (!space) {
          throw new LearningSpaceError(
            "invalid_input",
            "A selected operation depends on a space that was not selected.",
          );
        }
        return space.id;
      };

      const allGoals = await repos.goals.listOwned(userId);
      const goalsById = new Map(allGoals.map((goal) => [goal.id, goal]));
      for (const operation of proposal.moveGoals) {
        if (!selected.has(operation.operationId)) continue;
        const targetSpaceId = resolveTarget(operation.target);
        const goalIds = [
          ...new Set([
            operation.goalId,
            ...(operation.includeFoundationGoalIds ?? []),
          ]),
        ];
        const goals = goalIds.map((goalId) => goalsById.get(goalId));
        if (goals.some((goal) => !goal)) {
          throw new LearningSpaceError(
            "ownership",
            "A proposed goal is unavailable.",
          );
        }
        for (const goal of goals) {
          if (
            goal!.id !== operation.goalId &&
            (goal!.parentGoalId !== operation.goalId ||
              goal!.goalRelationType !== "foundation_support")
          ) {
            throw new LearningSpaceError(
              "invalid_input",
              "A proposed included goal is not a foundation goal of the moved goal.",
            );
          }
        }

        const existingItems = await Promise.all(
          goalIds.map((goalId) => repos.items.findByGoalId(userId, goalId)),
        );
        const existingIds = existingItems.flatMap((item) =>
          item ? [item.id] : [],
        );
        if (existingIds.length > 0) {
          await repos.relations.deleteByItemIds(userId, existingIds);
        }
        const targetItems = await repos.items.listBySpaceId(
          userId,
          targetSpaceId,
        );
        let nextSort = nextSortIndex(targetItems);
        for (const [index, goalId] of goalIds.entries()) {
          const existing = existingItems[index];
          if (existing) await repos.items.delete(userId, existing.id);
          const created = await repos.items.createGoalItem({
            userId,
            id: existing?.id ?? randomUUID(),
            spaceId: targetSpaceId,
            goalId,
            source: "assistant",
            sortIndex: nextSort++,
          });
          if (!created) {
            throw new LearningSpaceError(
              "ownership",
              "A proposed goal could not be placed in the target space.",
            );
          }
        }
      }

      for (const operation of proposal.plannedGoals) {
        if (!selected.has(operation.operationId)) continue;
        const targetSpaceId = resolveTarget(operation.target);
        const items = await repos.items.listBySpaceId(userId, targetSpaceId);
        const created = await repos.items.createPlannedGoalItem({
          userId,
          id: randomUUID(),
          spaceId: targetSpaceId,
          plannedTitle: cleanPlannedTitle(operation.title),
          rationale: cleanPurpose(operation.rationale),
          suggestedGoalKind:
            operation.suggestedGoalKind === "micro" ? "micro" : "full",
          goalBrief: validatedGoalBrief(operation.goalBrief),
          source: "assistant",
          sortIndex: nextSortIndex(items),
        });
        if (!created) {
          throw new LearningSpaceError(
            "ownership",
            "A proposed planned goal could not be created.",
          );
        }
        createdItemByRef.set(operation.ref, created.id);
      }

      for (const operation of proposal.reorderItems) {
        if (!selected.has(operation.operationId)) continue;
        const targetSpaceId =
          createdSpaceByRef.get(operation.spaceId) ?? operation.spaceId;
        const items = await repos.items.listBySpaceId(userId, targetSpaceId);
        if (items.length === 0) {
          throw new LearningSpaceError(
            "invalid_order",
            "A proposed roadmap has no available items to order.",
          );
        }
        const idByGoalId = new Map(
          items.flatMap((item) =>
            item.goalId ? [[item.goalId, item.id] as const] : [],
          ),
        );
        const ownedIds = new Set(items.map((item) => item.id));
        const preferred = operation.orderedItemIds.map((candidate) => {
          const resolved = ownedIds.has(candidate)
            ? candidate
            : (createdItemByRef.get(candidate) ?? idByGoalId.get(candidate));
          return resolved && ownedIds.has(resolved) ? resolved : undefined;
        });
        if (
          preferred.some((id) => !id) ||
          new Set(preferred).size !== preferred.length
        ) {
          throw new LearningSpaceError(
            "invalid_order",
            "A proposed roadmap order contains unavailable or duplicate items.",
          );
        }
        const preferredIds = preferred as string[];
        const preferredSet = new Set(preferredIds);
        const completeOrder = [
          ...preferredIds,
          ...items.map((item) => item.id).filter((id) => !preferredSet.has(id)),
        ];
        if (
          !(await repos.items.reorder(userId, targetSpaceId, completeOrder))
        ) {
          throw new LearningSpaceError(
            "invalid_order",
            "A proposed roadmap order is no longer valid.",
          );
        }
      }

      const resolveItem = async (
        spaceId: string,
        item: { itemId?: string; itemRef?: string; goalId?: string },
      ) => {
        const directId = item.itemRef
          ? createdItemByRef.get(item.itemRef)
          : item.itemId;
        if (directId) {
          const record = await repos.items.findById(userId, directId);
          if (record?.spaceId === spaceId) return record.id;
        }
        const legacyOrGoalId = item.goalId ?? item.itemRef ?? item.itemId;
        if (legacyOrGoalId) {
          const record = await repos.items.listBySpaceId(userId, spaceId);
          const found = record.find(
            (candidate) =>
              candidate.id === legacyOrGoalId ||
              candidate.goalId === legacyOrGoalId,
          );
          if (found) return found.id;
        }
        throw new LearningSpaceError(
          "invalid_input",
          "A selected relationship depends on an unavailable goal.",
        );
      };

      for (const operation of proposal.relations) {
        if (!selected.has(operation.operationId)) continue;
        const relationSpaceId = resolveTarget(operation.target);
        const fromItemId = await resolveItem(relationSpaceId, operation.from);
        const toItemId = await resolveItem(relationSpaceId, operation.to);
        const created = await repos.relations.create({
          userId,
          id: randomUUID(),
          spaceId: relationSpaceId,
          fromItemId,
          toItemId,
          relationType: relationType(operation.relationType),
          source: "assistant",
        });
        if (!created) {
          throw new LearningSpaceError(
            "invalid_input",
            "A proposed relationship is no longer valid.",
          );
        }
      }

      return {
        ok: true,
        createdSpaces: createdSpaceByRef.size,
        spaceIds: [...createdSpaceByRef.values()],
        itemIds: [...createdItemByRef.values()],
        appliedOperations: selected.size,
      } as const;
    });
  }

  async moveGoal(
    userId: string,
    goalId: string,
    input: { spaceId: string | null; includeFoundationGoalIds?: string[] },
  ) {
    return this.persistence.runInTransaction(async (repos) => {
      const goal = await repos.goals.findOwnedById(userId, goalId);
      if (!goal) throw new LearningSpaceError("not_found", "Goal not found.");
      if (input.spaceId) {
        const target = await repos.spaces.listByUserId(userId);
        if (!target.some((space) => space.id === input.spaceId)) {
          throw new LearningSpaceError(
            "not_found",
            "Learning Space not found.",
          );
        }
      }
      const allGoals = await repos.goals.listOwned(userId);
      const inferredFoundationIds = await Promise.all(
        allGoals
          .filter(
            (candidate) =>
              candidate.parentGoalId === goalId &&
              candidate.goalRelationType === "foundation_support",
          )
          .map(async (candidate) => {
            const item = await repos.items.findByGoalId(userId, candidate.id);
            const current = await repos.items.findByGoalId(userId, goalId);
            return item?.spaceId === (current?.spaceId ?? null)
              ? candidate.id
              : null;
          }),
      );
      const foundationIds =
        input.includeFoundationGoalIds ??
        inferredFoundationIds.filter((id): id is string => Boolean(id));
      const requestedIds = [...new Set([goalId, ...foundationIds])];
      const requestedGoals = allGoals.filter((candidate) =>
        requestedIds.includes(candidate.id),
      );
      if (requestedGoals.length !== requestedIds.length) {
        throw new LearningSpaceError(
          "ownership",
          "One or more goals are unavailable.",
        );
      }
      for (const candidate of requestedGoals) {
        if (
          candidate.id !== goalId &&
          (candidate.parentGoalId !== goalId ||
            candidate.goalRelationType !== "foundation_support")
        ) {
          throw new LearningSpaceError(
            "invalid_input",
            "Only foundation goals of the moved goal may be included.",
          );
        }
      }
      const existingItems = await Promise.all(
        requestedGoals.map((candidate) =>
          repos.items.findByGoalId(userId, candidate.id),
        ),
      );
      const existingItemIds = existingItems.flatMap((item) =>
        item ? [item.id] : [],
      );
      if (existingItemIds.length > 0) {
        await repos.relations.deleteByItemIds(userId, existingItemIds);
      }
      for (const [index, candidate] of requestedGoals.entries()) {
        const existing = existingItems[index];
        if (existing) await repos.items.delete(userId, existing.id);
        if (input.spaceId) {
          const targetItems = await repos.items.listBySpaceId(
            userId,
            input.spaceId,
          );
          const created = await repos.items.createGoalItem({
            userId,
            id: existing?.id ?? randomUUID(),
            spaceId: input.spaceId,
            goalId: candidate.id,
            source: existing?.source ?? "manual",
            sortIndex: nextSortIndex(targetItems),
          });
          if (!created)
            throw new LearningSpaceError(
              "not_found",
              "Learning Space not found.",
            );
        }
      }
      return {
        ok: true,
        goalIds: requestedIds,
        spaceId: input.spaceId,
      } as const;
    });
  }

  async createForGoal(
    userId: string,
    goalId: string,
    input: { name: string; purpose?: string },
  ) {
    const name = cleanName(input.name);
    const purpose = cleanPurpose(input.purpose);
    const space = await this.persistence.runInTransaction(async (repos) => {
      const goal = await repos.goals.findOwnedById(userId, goalId);
      if (!goal)
        throw new LearningSpaceError("ownership", "Learning goal not found.");
      const existingItem = await repos.items.findByGoalId(userId, goalId);
      if (existingItem) {
        const existingSpaces = await repos.spaces.listByUserId(userId);
        const existingSpace = existingSpaces.find(
          (candidate) => candidate.id === existingItem.spaceId,
        );
        if (existingSpace?.normalizedName === normalizeName(name))
          return existingSpace;
        throw new LearningSpaceError(
          "invalid_input",
          "This learning goal already belongs to a Learning Space.",
        );
      }
      const spaces = await repos.spaces.listByUserId(userId);
      const normalizedName = normalizeName(name);
      if (
        spaces.some((candidate) => candidate.normalizedName === normalizedName)
      ) {
        throw new LearningSpaceError(
          "duplicate_name",
          "A Learning Space with this name already exists.",
        );
      }
      const created = await repos.spaces.create({
        id: randomUUID(),
        userId,
        name,
        normalizedName,
        purpose,
        sortIndex:
          spaces.reduce(
            (max, candidate) => Math.max(max, candidate.sortIndex),
            -1,
          ) + 1,
        revision: 1,
      });
      const item = await repos.items.createGoalItem({
        userId,
        id: randomUUID(),
        spaceId: created.id,
        goalId,
        source: "assistant",
        sortIndex: 0,
      });
      if (!item)
        throw new LearningSpaceError(
          "ownership",
          "Learning goal could not be attached.",
        );
      return repos.spaces.update(userId, created.id, {
        revision: created.revision + 1,
      });
    });
    if (!space)
      throw new LearningSpaceError("not_found", "Learning Space not found.");
    return space;
  }
}

export type LearningSpacePortfolio = Awaited<
  ReturnType<MikroOrmLearningSpaceApplicationService["portfolio"]>
>;

export type LearningSpacePortfolioReader = (
  userId: string,
) => Promise<LearningSpacePortfolio>;
