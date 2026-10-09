import type { DiagnosticRemediationRepository } from "../../../domain/src/index.js";

export const DIAGNOSTIC_REMEDIATION_REPOSITORY = Symbol(
  "DIAGNOSTIC_REMEDIATION_REPOSITORY",
);

export type DiagnosticRemediationRepositoryToken =
  DiagnosticRemediationRepository;
