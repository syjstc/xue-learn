export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type NodeId = string;
export type RelationId = string;
export type LayoutId = string;
export type DocumentId = string;
export type OperationId = string;

export type NodeKind =
  | "value"
  | "connector"
  | "container"
  | "reference"
  | "placeholder";
/** Stored without `id`: the Record key is the stable identity. */
export interface FormalNode {
  kind: NodeKind;
  value?: JsonValue;
  contentType?: string;
  renderer?: string;
  props?: JsonObject;
  attributes?: JsonObject;
}
export interface ContainmentRelation {
  kind: "containment";
  parent: NodeId;
  child: NodeId;
  slot: string;
  index: number;
  role?: string;
}
export interface ConnectionRelation {
  kind: "connection";
  connector: NodeId;
  participant: NodeId;
  port: string;
  index: number;
  direction?: "in" | "out" | "neutral";
  role?: string;
}
export type FormalRelation = ContainmentRelation | ConnectionRelation;
export type SubjectRef =
  | { type: "node"; id: NodeId }
  | { type: "relation"; id: RelationId }
  | { type: "layout"; id: LayoutId };
export type NodeRef = { type: "node"; id: NodeId };
export type RelationRef = { type: "relation"; id: RelationId };
export interface LayoutNode {
  kind:
    | "subject"
    | "flow"
    | "stack"
    | "overlay"
    | "grid"
    | "attach"
    | "surround"
    | "free";
  subject?: NodeRef | RelationRef;
  children: LayoutId[];
  props?: JsonObject;
}
export interface FormalDocument {
  schemaVersion: 1;
  id: DocumentId;
  revision: number;
  nodes: Record<NodeId, FormalNode>;
  relations: Record<RelationId, FormalRelation>;
  layouts: Record<LayoutId, LayoutNode>;
  roots: NodeId[];
  layoutRoots: LayoutId[];
}

export type TableName = "nodes" | "relations" | "layouts";
export type Patch =
  | {
      op: "set";
      table: TableName;
      id: string;
      value: FormalNode | FormalRelation | LayoutNode;
    }
  | { op: "delete"; table: TableName; id: string }
  | { op: "setRoots"; target: "roots" | "layoutRoots"; value: string[] };
export interface SerializedCommand {
  type: string;
  [key: string]: JsonValue;
}
export interface HistoryEntry {
  id: OperationId;
  parentId?: OperationId;
  beforeRevision: number;
  afterRevision: number;
  command: SerializedCommand;
  patches: Patch[];
  inversePatches: Patch[];
  affectedSubjects: SubjectRef[];
  metadata?: JsonObject;
}
export interface HistoryView {
  entries: HistoryEntry[];
  currentId?: OperationId;
  branches: Record<string, OperationId[]>;
}
export interface OperationSuggestion {
  id: string;
  label: string;
  command: SerializedCommand;
  reason?: string;
}
export interface OperationRecommender {
  recommend(context: {
    document: FormalDocument;
    history: HistoryView;
    selection?: SubjectRef[];
  }): OperationSuggestion[];
}
export interface HookContext {
  document: FormalDocument;
  command: SerializedCommand;
  patches?: Patch[];
}
export type HookPrepareResult =
  void | { command?: SerializedCommand } | { reject: string };
export type HookCommitResult =
  void | { patches?: Patch[] } | { reject: string };
export interface OperationHook {
  beforePrepare?(
    context: HookContext,
  ): HookPrepareResult | Promise<HookPrepareResult>;
  beforeCommit?(
    context: HookContext,
  ): HookCommitResult | Promise<HookCommitResult>;
  afterCommit?(
    context: HookContext & { entry: HistoryEntry },
  ): void | Promise<void>;
  onReject?(error: RuntimeError): void | Promise<void>;
  onUndo?(entry: HistoryEntry): void | Promise<void>;
  onRedo?(entry: HistoryEntry): void | Promise<void>;
  onJump?(steps: HistoryEntry[]): void | Promise<void>;
}
export interface RuntimeError {
  code:
    | "VALIDATION"
    | "REVISION_CONFLICT"
    | "HOOK_REJECTED"
    | "HOOK_ERROR"
    | "COMMAND"
    | "IMPORT";
  message: string;
  details?: JsonValue;
}

export interface FormalTreeNode {
  id: NodeId;
  node: FormalNode;
  depth: number;
  via?: {
    relationId: RelationId;
    kind: FormalRelation["kind"];
    slotOrPort: string;
    index: number;
  };
  children: FormalTreeNode[];
  /** The same stable node is reachable elsewhere in this projection. */
  shared?: boolean;
  /** A non-owning connection points back into the current traversal path. */
  cycle?: boolean;
}
export type RuntimeEvent = {
  type: "commit" | "undo" | "redo" | "jump" | "reject";
  document: FormalDocument;
  entry?: HistoryEntry;
  steps?: HistoryEntry[];
  error?: RuntimeError;
};
export type RuntimeListener = (event: RuntimeEvent) => void;
