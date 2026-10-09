import type { LabManifestV1 } from "../../../libs/lab-protocol/src/index.js";

export type UnitLabDefinition = {
  type: "unit_lab";
  schemaVersion?: 1 | 2;
  title: string;
  summary: string;
  items: Array<{
    id: string;
    status: "ready" | "failed";
    title: string;
    componentType: string;
    kind?: "embedded_lab" | "inline_component" | "failed";
    manifest?: LabManifestV1;
    block?: Record<string, unknown>;
    error?: string;
    fallbackBody?: string;
  }>;
};

export type UnitLabContent = {
  status: string;
  recommended?: boolean;
  recommendation?: string;
  revision?: number;
  definition?: UnitLabDefinition | null;
  generationError?: string;
};

function hasLabItems(
  content: UnitLabContent | null | undefined,
): boolean {
  return Boolean(content?.definition?.items?.length);
}

/** Session GET is dynamic-only; lab bodies arrive as `unitLabContent` or a streamed `unitLab.definition`. */
export function unitLabContentFromPayload(
  data: Record<string, unknown> | null | undefined,
): UnitLabContent | null {
  if (!data) return null;
  const direct = data.unitLabContent;
  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    return direct as UnitLabContent;
  }
  const streamed = data.unitLab;
  if (!streamed || typeof streamed !== "object" || Array.isArray(streamed)) {
    return null;
  }
  const lab = streamed as {
    definition?: UnitLabDefinition | null;
    status?: string;
    revision?: number;
    recommended?: boolean;
    recommendation?: string;
    generationError?: string;
  };
  if (!lab.definition && lab.status !== "failed") return null;
  return {
    status: lab.status ?? "ready",
    recommended: lab.recommended,
    recommendation: lab.recommendation,
    revision: lab.revision,
    definition: lab.definition,
    generationError: lab.generationError,
  };
}

export function keepReadyUnitLabContent(
  prev: UnitLabContent | null,
  next: UnitLabContent | null,
): UnitLabContent | null {
  if (!hasLabItems(next) && hasLabItems(prev)) return prev;
  return next;
}

/** Full-goal web/desktop journeys always list the lab; micro courses stay hidden. */
export function isUnitLabActivityAvailable(
  _content: { status?: string; definition?: unknown; recommended?: boolean } | null | undefined,
  isMicro: boolean,
): boolean {
  return !isMicro;
}

/** Host-side iframe Lab runtime is the default 3D path for Web/desktop. */
export function isStandaloneLabRuntimeEnabled(): boolean {
  return true;
}
