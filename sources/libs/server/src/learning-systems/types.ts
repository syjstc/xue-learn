import type { z } from "zod";
import type { CapabilityToolSet } from "../agents/core/tool-capability.js";

export type LearningSystemKind =
  "learning_system" | "core_provider" | "tool_provider" | "tool_capability";

export type SettingsScope = "global" | "user" | "goal";
export type SubjectScope = "user" | "goal" | "module" | "unit" | "thread";

export type ContextAuthority =
  | "server_policy"
  | "objective_definition"
  | "verified_learner_state"
  | "verified_source"
  | "learner_declared_context"
  | "pedagogical_guidance"
  | "conversation_context";

export type SystemViewKey = string;
export type CapabilityQueryToolKey = string;
export type SystemCommandType = string;
export type DomainEventType = string;

export type LearningSystemSubject = {
  userId?: string;
  goalId?: string;
  moduleId?: string;
  unitId?: string;
  threadId?: string;
};

export type ContextFreshness = {
  asOf: string;
  stale: boolean;
};

export type ContextEnvelope<T = unknown> = {
  ownerCapabilityId: string;
  ownerCapabilityVersion: string;
  schemaVersion: number;
  authority: ContextAuthority;
  scope: LearningSystemSubject;
  freshness: ContextFreshness;
  data: T;
};

export type SystemViewRequest = {
  key: SystemViewKey;
  operation?: string;
  subject: LearningSystemSubject;
  query?: string;
  /**
   * Ephemeral, server-owned invocation data for a view whose projection cannot
   * be reconstructed from durable subject scope alone. Capabilities validate
   * and consume only their own fields.
   */
  invocation?: unknown;
  signal?: AbortSignal;
};

export type EagerViewProfile = {
  key: SystemViewKey;
  required: boolean;
  allowStale: boolean;
  maxTokens: number;
  /** Stable model-visible ordering; lower-volatility layers precede live data. */
  promptLayer?: CapabilityPromptLayer;
  /** Stable order within a layer; lower-change views should use lower values. */
  promptOrder?: number;
  /** Semantic reuse/scope classification used for ordering and profile audits. */
  semanticClass?: CapabilityContextSemanticClass;
};

export const CAPABILITY_PROMPT_LAYER_ORDER = Object.freeze([
  "platform_policy",
  "learner_context",
  "reusable_guidance",
  "reusable_feature_policy",
  "goal_context",
  "module_context",
  "unit_context",
  "operation_instruction",
  "volatile_context",
] as const);

export type CapabilityPromptLayer =
  (typeof CAPABILITY_PROMPT_LAYER_ORDER)[number];

export type CapabilityContextSemanticClass =
  | "platform_policy"
  | "teacher_context"
  | "domain_teaching_guidance"
  | "feature_policy"
  | "goal_projection"
  | "module_projection"
  | "unit_projection"
  | "operation_instruction"
  | "volatile_context";

export type LazyToolProfile = {
  key: CapabilityQueryToolKey;
  maxCalls: number;
  maxResultTokens: number;
};

export type GenerationContextProfile = {
  eagerViews: EagerViewProfile[];
  lazyTools: LazyToolProfile[];
  maxEagerContextTokens: number;
  maxLazyContextTokens: number;
  maxToolRounds: number;
};

export type CapabilityDependency = {
  capabilityId: string;
  optional?: boolean;
  minimumVersion?: string;
};

export type LearningSystemManifest = {
  id: string;
  version: string;
  kind: LearningSystemKind;
  providesViews?: SystemViewKey[];
  providesQueryTools?: CapabilityQueryToolKey[];
  providesToolSets?: string[];
  acceptsCommands?: SystemCommandType[];
  subscribesToEvents?: DomainEventType[];
  settingsScopes?: SettingsScope[];
  dependencies?: CapabilityDependency[];
};

export type CapabilityQueryResult<TResult = unknown> = ContextEnvelope<TResult>;

export type BoundToolSubject = LearningSystemSubject & {
  userId: string;
};

export type CapabilityQueryTool<TInput = unknown, TResult = unknown> = {
  key: CapabilityQueryToolKey;
  ownerCapabilityId: string;
  schemaVersion: number;
  description: string;
  inputSchema: z.ZodType<TInput>;
  resultSchema: z.ZodType<TResult>;
  requiredScopes: SubjectScope[];
  authority: ContextAuthority;
  maxResultTokens: number;
  query: (
    subject: BoundToolSubject,
    input: TInput,
    signal?: AbortSignal,
  ) => Promise<CapabilityQueryResult<TResult>>;
};

export type SettingsSubject = LearningSystemSubject & {
  adminUserId?: string;
};

export type CapabilitySettingsPort<TRead = unknown, TPatch = unknown> = {
  capabilityId: string;
  scope: SettingsScope;
  read: (subject: SettingsSubject) => Promise<TRead>;
  validatePatch: (input: unknown) => TPatch;
  patch: (subject: SettingsSubject, patch: TPatch) => Promise<TRead>;
};

export type TransactionContext = unknown;

export type SystemCommand<TPayload = unknown> = {
  type: SystemCommandType;
  subject: LearningSystemSubject;
  payload: TPayload;
  idempotencyKey?: string;
};

export type SystemCommandResult<T = unknown> = {
  handledBy: string;
  value: T;
};

export type DomainEvent<TPayload = unknown> = {
  id: string;
  type: DomainEventType;
  schemaVersion: number;
  subject: LearningSystemSubject;
  occurredAt: string;
  payload: TPayload;
};

export type LearningSystemCapability = {
  manifest: LearningSystemManifest;
  getView?: (request: SystemViewRequest) => Promise<ContextEnvelope | null>;
  getQueryTools?: () => CapabilityQueryTool[];
  getToolSets?: () => CapabilityToolSet[];
  getSettingsPorts?: () => CapabilitySettingsPort[];
  handleCommand?: (
    command: SystemCommand,
    transaction?: TransactionContext,
  ) => Promise<SystemCommandResult>;
  handleEvent?: (event: DomainEvent) => Promise<void>;
};

export type ResolvedContextView = {
  profile: EagerViewProfile;
  envelope: ContextEnvelope;
  estimatedTokens: number;
  truncated: boolean;
};

export type ContextResolutionDiagnostic = {
  key: SystemViewKey;
  code:
    "not_registered" | "not_active" | "unavailable" | "stale" | "over_budget";
  required: boolean;
  message: string;
};

export type ResolvedGenerationContext = {
  views: ResolvedContextView[];
  diagnostics: ContextResolutionDiagnostic[];
  estimatedTokens: number;
};
