import {
  normalizeChemistryLabDefinition,
  solveCircuit,
  type CircuitSandbox,
  type ChemistryStage,
} from "../../../domain/src/index.js";
import { wrapInteractiveHtmlDocument } from "../llm/safe-interactive-html.js";
import { interactiveBlockSchema, type InteractiveBlock } from "../llm/schemas.js";

export function verifyLabInteractiveBlock(
  block: InteractiveBlock,
): string | null {
  if (block.type === "circuit_sandbox") {
    return verifyCircuitSandbox(block);
  }
  if (block.type === "interactive_html") {
    const wrapped = wrapInteractiveHtmlDocument(block.html);
    if (!wrapped) return "interactive HTML failed sanitizer or parse checks";
    if (!wrapped.includes("XueLearnLab") || !wrapped.includes("xl-lab")) {
      return "interactive HTML is missing the lab host environment";
    }
  }
  return null;
}

function verifyCircuitSandbox(
  block: Extract<InteractiveBlock, { type: "circuit_sandbox" }>,
): string | null {
  const sandbox = block as unknown as CircuitSandbox;
  const solution = solveCircuit(sandbox);
  if (!solution.isCompleteCircuit) {
    return "circuit sandbox is not a complete closed loop";
  }
  const currents = Object.values(solution.parts)
    .filter((part) => part.kind !== "voltmeter")
    .map((part) => Math.abs(part.current));
  const hasBattery = Object.values(solution.parts).some(
    (part) => part.kind === "battery",
  );
  if (
    hasBattery &&
    currents.length > 0 &&
    currents.every((amps) => amps < 1e-4)
  ) {
    return "circuit sandbox solves to ~0 A with a closed loop and a source";
  }
  return null;
}

export function parseVerifiedLabBlock(value: unknown): InteractiveBlock | null {
  const parsed = interactiveBlockSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.type !== "chemistry_lab") return parsed.data;
  const normalized = normalizeChemistryLabDefinition({
    experimentId: parsed.data.experimentId,
    experimentVersion: parsed.data.experimentVersion,
    title: parsed.data.title,
    summary: parsed.data.summary,
    stage: parsed.data.stage as ChemistryStage,
    targetObservation: parsed.data.targetObservation,
    parameters: parsed.data.parameters,
    strictParameters: true,
  });
  return (normalized as unknown as InteractiveBlock) ?? null;
}
