export class DerivationError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly formulaId?: string;
  readonly stepId?: string;
  readonly expectedRevision?: number;
  readonly actualRevision?: number;

  constructor(input: {
    code: string;
    message: string;
    retryable?: boolean;
    formulaId?: string;
    stepId?: string;
    expectedRevision?: number;
    actualRevision?: number;
  }) {
    super(input.message);
    this.name = "DerivationError";
    this.code = input.code;
    this.retryable = input.retryable ?? false;
    this.formulaId = input.formulaId;
    this.stepId = input.stepId;
    this.expectedRevision = input.expectedRevision;
    this.actualRevision = input.actualRevision;
  }

  toJSON() {
    return {
      ok: false as const,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      formulaId: this.formulaId,
      stepId: this.stepId,
      expectedRevision: this.expectedRevision,
      actualRevision: this.actualRevision,
    };
  }
}

export function revisionConflict(kind: "derivation" | "formula", expected: number, actual: number) {
  return new DerivationError({
    code: "revision_conflict",
    message: `${kind} baseRevision ${expected} is stale; current revision is ${actual}. Call inspect_derivation and retry.`,
    retryable: true,
    expectedRevision: expected,
    actualRevision: actual,
  });
}
