import { EntitySchema } from "@mikro-orm/core";
import { UserEntity } from "./user.entity.ts";

/** Final scalar LearningGoal metadata; dependent curriculum tables stay separate. */
export class LearningGoalEntity {
  user!: UserEntity | string | null;
  parentGoal!: LearningGoalEntity | string | null;
  id!: string;
  title!: string;
  level!: string;
  domainTag = "general";
  topicCategory = "general";
  contentLanguage = "auto";
  teachingPersonaRef: string | null = null;
  generationOptions = "";
  goalKind = "full";
  learningMode = "mastery";
  learningModeTransitionStatus = "idle";
  learningModeTransitionToken: string | null = null;
  learningModeTransitionStartedAt: Date | null = null;
  learningModeTransitionError = "";
  learningModeTransitionArtifacts: Record<string, unknown> = {};
  planningMode = "fast";
  curriculumVersion = 1;
  status = "active";
  pathSource = "generic";
  topicOverview = "";
  mapSummaryJson = "{}";
  mapSummaryStatus = "pending";
  mapPlanJson = "{}";
  mapPlanStatus = "pending";
  detailedPlanStatus = "pending";
  cognitiveModelEnabled = false;
  cognitiveModelStatus = "pending";
  cognitiveModelVersion = 0;
  cognitiveModelInputHash = "";
  cognitiveModelPublishedHash = "";
  iconSvg = "";
  iconTint = "";
  goalRelationType: string | null = null;
  goalRelationContextJson: Record<string, unknown> | null = null;
  overviewCourseStatus = "pending";
  shareVisibility = "off";
  activeShareId: string | null = null;
  createdAt!: Date;
  updatedAt!: Date;
}

export const LearningGoalSchema = new EntitySchema<LearningGoalEntity>({
  class: LearningGoalEntity,
  name: "LearningGoal",
  tableName: "LearningGoal",
  properties: {
    user: {
      kind: "m:1",
      entity: () => UserEntity,
      fieldName: "userId",
      mapToPk: true,
      nullable: true,
      deleteRule: "set null",
      updateRule: "cascade",
      foreignKeyName: "LearningGoal_userId_fkey",
    },
    parentGoal: {
      kind: "m:1",
      entity: () => LearningGoalEntity,
      fieldName: "parentGoalId",
      mapToPk: true,
      nullable: true,
      deleteRule: "set null",
      updateRule: "cascade",
      foreignKeyName: "LearningGoal_parentGoalId_fkey",
    },
    id: {
      type: String,
      columnType: "text",
      primary: true,
      fieldName: "id",
    },
    title: { type: String, columnType: "text", fieldName: "title" },
    level: { type: String, columnType: "text", fieldName: "level" },
    domainTag: {
      type: String,
      columnType: "text",
      default: "general",
      fieldName: "domainTag",
    },
    topicCategory: {
      type: String,
      columnType: "text",
      default: "general",
      fieldName: "topicCategory",
    },
    contentLanguage: {
      type: String,
      columnType: "text",
      default: "auto",
      fieldName: "contentLanguage",
    },
    teachingPersonaRef: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "teachingPersonaRef",
    },
    generationOptions: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "generationOptions",
    },
    goalKind: {
      type: String,
      columnType: "text",
      default: "full",
      fieldName: "goalKind",
    },
    learningMode: {
      type: String,
      columnType: "text",
      default: "mastery",
      fieldName: "learningMode",
    },
    learningModeTransitionStatus: {
      type: String,
      columnType: "text",
      default: "idle",
      fieldName: "learningModeTransitionStatus",
    },
    learningModeTransitionToken: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "learningModeTransitionToken",
    },
    learningModeTransitionStartedAt: {
      type: Date,
      columnType: "timestamp(3)",
      nullable: true,
      fieldName: "learningModeTransitionStartedAt",
    },
    learningModeTransitionError: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "learningModeTransitionError",
    },
    learningModeTransitionArtifacts: {
      type: "json",
      defaultRaw: "'{}'",
      fieldName: "learningModeTransitionArtifacts",
    },
    planningMode: {
      type: String,
      columnType: "text",
      default: "fast",
      fieldName: "planningMode",
    },
    curriculumVersion: {
      type: Number,
      columnType: "integer",
      default: 1,
      fieldName: "curriculumVersion",
    },
    status: {
      type: String,
      columnType: "text",
      default: "active",
      fieldName: "status",
    },
    pathSource: {
      type: String,
      columnType: "text",
      default: "generic",
      fieldName: "pathSource",
    },
    topicOverview: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "topicOverview",
    },
    mapSummaryJson: {
      type: String,
      columnType: "text",
      default: "{}",
      fieldName: "mapSummaryJson",
    },
    mapSummaryStatus: {
      type: String,
      columnType: "text",
      default: "pending",
      fieldName: "mapSummaryStatus",
    },
    mapPlanJson: {
      type: String,
      columnType: "text",
      default: "{}",
      fieldName: "mapPlanJson",
    },
    mapPlanStatus: {
      type: String,
      columnType: "text",
      default: "pending",
      fieldName: "mapPlanStatus",
    },
    detailedPlanStatus: {
      type: String,
      columnType: "text",
      default: "pending",
      fieldName: "detailedPlanStatus",
    },
    cognitiveModelEnabled: {
      type: Boolean,
      columnType: "boolean",
      default: false,
      fieldName: "cognitiveModelEnabled",
    },
    cognitiveModelStatus: {
      type: String,
      columnType: "text",
      default: "pending",
      fieldName: "cognitiveModelStatus",
    },
    cognitiveModelVersion: {
      type: Number,
      columnType: "integer",
      default: 0,
      fieldName: "cognitiveModelVersion",
    },
    cognitiveModelInputHash: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "cognitiveModelInputHash",
    },
    cognitiveModelPublishedHash: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "cognitiveModelPublishedHash",
    },
    iconSvg: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "iconSvg",
    },
    iconTint: {
      type: String,
      columnType: "text",
      default: "",
      fieldName: "iconTint",
    },
    goalRelationType: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "goalRelationType",
    },
    goalRelationContextJson: {
      type: "json",
      nullable: true,
      fieldName: "goalRelationContextJson",
    },
    overviewCourseStatus: {
      type: String,
      columnType: "text",
      default: "pending",
      fieldName: "overviewCourseStatus",
    },
    shareVisibility: {
      type: String,
      columnType: "text",
      default: "off",
      fieldName: "shareVisibility",
    },
    activeShareId: {
      type: String,
      columnType: "text",
      nullable: true,
      fieldName: "activeShareId",
    },
    createdAt: {
      type: Date,
      columnType: "timestamp(3)",
      defaultRaw: "CURRENT_TIMESTAMP",
      fieldName: "createdAt",
      onCreate: () => new Date(),
    },
    updatedAt: {
      type: Date,
      columnType: "timestamp(3)",
      fieldName: "updatedAt",
      onCreate: () => new Date(),
      onUpdate: () => new Date(),
    },
  },
  indexes: [
    { name: "LearningGoal_userId_idx", properties: ["user"] },
    {
      name: "LearningGoal_userId_updatedAt_idx",
      properties: ["user", "updatedAt"],
    },
    { name: "LearningGoal_parentGoalId_idx", properties: ["parentGoal"] },
    {
      name: "LearningGoal_parentGoalId_goalRelationType_idx",
      properties: ["parentGoal", "goalRelationType"],
    },
    {
      name: "LearningGoal_learningMode_learningModeTransitionStatus_idx",
      properties: ["learningMode", "learningModeTransitionStatus"],
    },
  ],
  checks: [
    {
      name: "LearningGoal_planningMode_check",
      expression: "\"planningMode\" IN ('fast', 'deep', 'docs_first')",
    },
    {
      name: "LearningGoal_cognitiveModelStatus_check",
      expression:
        "\"cognitiveModelStatus\" IN ('pending', 'building', 'ready', 'needs_reconciliation', 'failed')",
    },
    {
      name: "LearningGoal_cognitiveModelVersion_check",
      expression: '"cognitiveModelVersion" >= 0',
    },
  ],
});
