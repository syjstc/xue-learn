import { DERIVATION_LIMITS } from "../limits.js";
import {
  commitDerivationStep,
  compileInitialFormulas,
  createCheckpoint,
  replayDerivation,
} from "../materialize.js";
import { eq, plus, tok } from "../authoring.js";
import { DERIVATION_SCHEMA_VERSION } from "../limits.js";
import type { DerivationDocumentV1 } from "../types.js";

function utf8Size(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function buildStorageBenchmarkDocument(): DerivationDocumentV1 {
  const seeds = [
    { id: "f1", tree: eq(tok("a", "a1"), tok("1", "n1"), "eq1") },
    { id: "f2", tree: eq(tok("b", "b1"), tok("2", "n2"), "eq2") },
    { id: "f3", tree: eq(tok("c", "c1"), tok("3", "n3"), "eq3") },
    { id: "f4", tree: eq(tok("d", "d1"), tok("4", "n4"), "eq4") },
  ];
  let state = compileInitialFormulas(seeds);
  const steps = [];
  const formulaIds = ["f1", "f2", "f3", "f4"] as const;
  for (let index = 0; index < 20; index += 1) {
    const formulaId = formulaIds[index % 4]!;
    const formula = state.formulas[formulaId]!;
    const presentationOnly = index % 5 === 4;
    const committed = commitDerivationStep(state, {
      baseRevision: state.derivationRevision,
      summary: presentationOnly ? `Explain ${formulaId}` : `Mutate ${formulaId}`,
      source: "migration",
      actions: presentationOnly
        ? []
        : [
            {
              type: "formula.transform",
              formulaId,
              baseFormulaRevision: formula.revision,
              transform: {
                type: "replace_subtree",
                target: { type: "node", id: formula.document.roots[0]! },
                replacement: eq(
                  tok(formulaId, `${formulaId}-left-${index}`),
                  plus(
                    tok(String(index), `${formulaId}-n-${index}`),
                    tok("1", `${formulaId}-one-${index}`),
                    `${formulaId}-sum-${index}`,
                  ),
                  `${formulaId}-eq-${index}`,
                ),
              },
            },
          ],
      presentation: {
        narration: [{ id: `n${index + 1}`, text: `Step ${index + 1}` }],
        focus: [{ type: "formula", formulaId }],
        highlight: [
          {
            subject: { type: "formula", formulaId },
            tone: "primary",
            emphasis: presentationOnly ? "soft" : "strong",
          },
        ],
      },
    });
    steps.push(committed.step);
    state = committed.state;
  }
  return {
    schemaVersion: DERIVATION_SCHEMA_VERSION,
    id: "storage-benchmark-20x4",
    title: "Storage benchmark",
    locale: "en",
    revision: state.derivationRevision,
    status: "draft",
    requirement: { text: "Deterministic 20-step 4-formula storage benchmark." },
    initialFormulas: seeds,
    steps,
  };
}

export function measureDerivationStorage(document: DerivationDocumentV1) {
  const snapshots: unknown[] = [];
  const runtimeExports: Array<{
    formulaId: string;
    base: unknown;
    entries: unknown[];
  }> = Object.keys(
    compileInitialFormulas(document.initialFormulas).formulas,
  ).map((formulaId) => ({
    formulaId,
    base: compileInitialFormulas(document.initialFormulas).formulas[formulaId]!.document,
    entries: [],
  }));
  const runtimeByFormula = new Map(runtimeExports.map((item) => [item.formulaId, item]));
  const checkpoints = [];
  let previous = compileInitialFormulas(document.initialFormulas);
  for (let ordinal = 0; ordinal <= document.steps.length; ordinal += 1) {
    const state = replayDerivation(document, { throughOrdinal: ordinal });
    snapshots.push(
      Object.fromEntries(
        Object.entries(state.formulas).map(([formulaId, formula]) => [
          formulaId,
          formula.document,
        ]),
      ),
    );
    if (ordinal > 0) {
      for (const [formulaId, formula] of Object.entries(state.formulas)) {
        const before = previous.formulas[formulaId];
        if (!before || before.revision === formula.revision) continue;
        runtimeByFormula.get(formulaId)?.entries.push({
          beforeRevision: before.revision,
          afterRevision: formula.revision,
          patches: formula.document,
          inversePatches: before.document,
        });
      }
    }
    previous = state;
    if (ordinal > 0 && ordinal % DERIVATION_LIMITS.checkpointInterval === 0) {
      checkpoints.push(createCheckpoint(state, ordinal));
    }
  }
  const semanticBytes = utf8Size({
    requirement: document.requirement,
    initialFormulas: document.initialFormulas,
    steps: document.steps,
    checkpoints,
  });
  const snapshotBytes = utf8Size({
    requirement: document.requirement,
    snapshots,
  });
  const runtimeBytes = utf8Size({
    requirement: document.requirement,
    runtimeExports,
  });
  return {
    semanticBytes,
    snapshotBytes,
    runtimeBytes,
    reductionVsRuntime: 1 - semanticBytes / Math.max(runtimeBytes, 1),
    reductionVsSnapshots: 1 - semanticBytes / Math.max(snapshotBytes, 1),
  };
}
