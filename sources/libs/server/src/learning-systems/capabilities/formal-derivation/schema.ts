import { z } from "zod";

const subjectRefSchema = z.object({
  type: z.enum(["node", "relation", "layout"]),
  id: z.string().min(1),
});

const nodeSubjectRefSchema = z.object({
  type: z.literal("node"),
  id: z.string().min(1),
});

const derivationSubjectRefSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("formula"),
    formulaId: z.string().min(1),
  }),
  z.object({
    type: z.literal("subject"),
    formulaId: z.string().min(1),
    subject: subjectRefSchema,
  }),
]);

const authoringLayoutSchema = z.object({
  kind: z.enum([
    "subject",
    "flow",
    "stack",
    "overlay",
    "grid",
    "attach",
    "surround",
    "free",
  ]),
  props: z.record(z.string(), z.unknown()).optional(),
  includeSelf: z.boolean().optional(),
});

const authoringTreeSchema: z.ZodType<Record<string, unknown>> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("token"),
        id: z.string().min(1).optional(),
        value: z.unknown(),
        renderer: z.string().min(1).optional(),
        contentType: z.string().optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        layout: authoringLayoutSchema.optional(),
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("operator"),
        id: z.string().min(1).optional(),
        token: z.string().min(1),
        renderer: z.string().min(1).optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        layout: authoringLayoutSchema.optional(),
        operands: z
          .array(
            z.object({
              port: z.string().optional(),
              direction: z.enum(["in", "out", "neutral"]).optional(),
              role: z.string().optional(),
              node: authoringTreeSchema,
            }),
          )
          .min(1),
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("container"),
        id: z.string().min(1).optional(),
        renderer: z.string().min(1),
        attributes: z.record(z.string(), z.unknown()).optional(),
        layout: authoringLayoutSchema.optional(),
        slots: z
          .array(
            z.object({
              name: z.string().min(1),
              role: z.string().optional(),
              node: authoringTreeSchema,
            }),
          )
          .min(1),
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("placeholder"),
        id: z.string().min(1).optional(),
        label: z.string().optional(),
        attributes: z.record(z.string(), z.unknown()).optional(),
        layout: authoringLayoutSchema.optional(),
      })
      .passthrough(),
    z
      .object({
        kind: z.literal("reference"),
        id: z.string().min(1).optional(),
        targetId: z.string().min(1),
        attributes: z.record(z.string(), z.unknown()).optional(),
        layout: authoringLayoutSchema.optional(),
      })
      .passthrough(),
  ]),
);

const formulaSeedSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  tree: authoringTreeSchema,
  display: z
    .object({
      role: z
        .enum([
          "definition",
          "assumption",
          "working",
          "theorem",
          "result",
          "reference",
        ])
        .optional(),
      caption: z.string().optional(),
      pinned: z.boolean().optional(),
    })
    .optional(),
});

const formulaTransformSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("replace_subtree"),
    target: subjectRefSchema,
    replacement: authoringTreeSchema,
  }),
  z.object({
    type: z.literal("relocate_subtree"),
    target: nodeSubjectRefSchema,
    replacement: authoringTreeSchema,
    moving: z.array(nodeSubjectRefSchema).min(1).max(8),
  }),
  z.object({
    type: z.literal("swap_subtrees"),
    left: subjectRefSchema,
    right: subjectRefSchema,
  }),
  z.object({
    type: z.literal("substitute"),
    target: subjectRefSchema,
    binding: authoringTreeSchema,
  }),
  z.object({
    type: z.literal("substitute_many"),
    substitutions: z
      .array(
        z.object({
          target: nodeSubjectRefSchema,
          binding: authoringTreeSchema,
        }),
      )
      .min(2)
      .max(8),
  }),
  z.object({
    type: z.literal("expand"),
    target: subjectRefSchema,
    ruleId: z.string().min(1),
  }),
  z.object({
    type: z.literal("simplify"),
    target: subjectRefSchema,
    ruleId: z.string().min(1),
  }),
  z.object({
    type: z.literal("differentiate"),
    target: subjectRefSchema,
    variable: z.string().min(1),
    ruleId: z.string().min(1),
  }),
  z.object({
    type: z.literal("rewrite_by_definition"),
    target: subjectRefSchema,
    ruleId: z.string().min(1),
  }),
  z.object({
    type: z.literal("apply_theorem"),
    theoremId: z.string().min(1),
    targets: z.array(subjectRefSchema).min(1),
  }),
]);

const derivationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("formula.add"),
    formula: formulaSeedSchema,
    provenance: z
      .object({
        derivedFromFormulaId: z.string().min(1),
        kind: z.enum(["copy", "specialize", "consequence", "reference"]),
        subjectMap: z
          .array(
            z.object({
              from: subjectRefSchema,
              to: subjectRefSchema,
            }),
          )
          .optional(),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("formula.transform"),
    formulaId: z.string().min(1),
    baseFormulaRevision: z.number().int().nonnegative(),
    transform: formulaTransformSchema,
  }),
  z.object({
    type: z.literal("formula.set_metadata"),
    formulaId: z.string().min(1),
    patch: z.object({
      role: z
        .enum([
          "definition",
          "assumption",
          "working",
          "theorem",
          "result",
          "reference",
        ])
        .optional(),
      caption: z.string().optional(),
      pinned: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("subject.set_attribute"),
    formulaId: z.string().min(1),
    baseFormulaRevision: z.number().int().nonnegative(),
    subject: subjectRefSchema,
    key: z.string().min(1),
    value: z.unknown(),
  }),
]);

const presentationSchema = z.object({
  narration: z
    .array(
      z.object({
        id: z.string().min(1),
        text: z.string().min(1),
        related: z.array(derivationSubjectRefSchema).optional(),
      }),
    )
    .optional(),
  formulaVisibility: z
    .array(
      z.object({
        formulaId: z.string().min(1),
        state: z.enum(["visible", "hidden"]),
      }),
    )
    .optional(),
  focus: z.array(derivationSubjectRefSchema).optional(),
  highlight: z
    .array(
      z.object({
        subject: derivationSubjectRefSchema,
        tone: z.enum(["primary", "success", "warning", "danger", "muted"]),
        emphasis: z.enum(["soft", "strong"]),
      }),
    )
    .optional(),
  dimOthers: z.boolean().optional(),
  pauseMs: z.number().int().nonnegative().optional(),
});

const derivationBranchSchema = z.object({
  role: z.enum(["split", "case", "join"]),
  splitId: z.string().min(1),
  caseId: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  assumption: z.string().min(1).optional(),
  cases: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        assumption: z.string().min(1).optional(),
      }),
    )
    .optional(),
});

export const inspectDerivationArgsSchema = z.object({});

export const commitDerivationStepArgsSchema = z.object({
  baseRevision: z.number().int().nonnegative(),
  summary: z.string().min(1),
  actions: z.array(derivationActionSchema),
  presentation: presentationSchema.optional().default({}),
  branch: derivationBranchSchema.optional(),
  kind: z.enum(["teaching", "summary"]).optional(),
});

export const validateDerivationArgsSchema = z.object({});

export const finishDerivationArgsSchema = z.object({
  summary: z.string().min(1).max(1200),
  validatedRevision: z.number().int().nonnegative(),
});

export const finishExpansionArgsSchema = z.object({});
