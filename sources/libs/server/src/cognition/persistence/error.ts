export const COGNITION_INFERENCE_VERSION = 1;

export class CognitionPersistenceError extends Error {
  readonly code:
    | "invalid_declaration"
    | "invalid_candidate"
    | "not_found"
    | "ownership_mismatch"
    | "idempotency_conflict"
    | "immutable_declaration"
    | "inactive_evidence";

  constructor(code: CognitionPersistenceError["code"], message: string) {
    super(message);
    this.name = "CognitionPersistenceError";
    this.code = code;
  }
}
