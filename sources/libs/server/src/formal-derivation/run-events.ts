import type { FormalDerivationRunEventV1 } from "../../../formal-derivation/src/index.js";

export function encodeFormalDerivationSseEvent(
  sequence: number,
  event: FormalDerivationRunEventV1,
): string {
  return `id: ${sequence}\ndata: ${JSON.stringify({ sequence, event })}\n\n`;
}

export function parseStoredFormalDerivationEvent(eventJson: string): FormalDerivationRunEventV1 {
  return JSON.parse(eventJson) as FormalDerivationRunEventV1;
}
