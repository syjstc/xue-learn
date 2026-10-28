import {
  compileAuthoringTree,
  decompileAuthoringTree,
  type AuthoringTree,
  type FormalDocument,
  type SubjectRef,
} from "../../formal-expression-core/src/index.js";
import { authoringContainsId, replaceAuthoringNode } from "./authoring.js";
import { DerivationError } from "./errors.js";

export function replaceSubtree(
  document: FormalDocument,
  target: SubjectRef,
  replacement: AuthoringTree,
): {
  document: FormalDocument;
  affectedSubjects: SubjectRef[];
  subjectMap: Array<{ before: SubjectRef; after: SubjectRef }>;
} {
  if (target.type !== "node") {
    throw new DerivationError({
      code: "invalid_target",
      message: "replace_subtree requires a node subject.",
    });
  }
  if (!document.nodes[target.id]) {
    throw new DerivationError({
      code: "missing_target",
      message: `Target node ${target.id} does not exist in this formula.`,
    });
  }
  const tree = decompileAuthoringTree(document);
  if (!authoringContainsId(tree, target.id)) {
    throw new DerivationError({
      code: "missing_target",
      message: `Target node ${target.id} is not in the formula tree.`,
    });
  }
  const beforeIds = new Set(Object.keys(document.nodes));
  const nextTree = replaceAuthoringNode(tree, target.id, {
    ...structuredClone(replacement),
    id: replacement.id ?? target.id,
  } as AuthoringTree);
  const compiled = compileAuthoringTree(nextTree, document.id);
  compiled.revision = document.revision + 1;
  const afterIds = new Set(Object.keys(compiled.nodes));
  const subjectMap: Array<{ before: SubjectRef; after: SubjectRef }> = [];
  for (const id of beforeIds) {
    if (afterIds.has(id)) {
      subjectMap.push({
        before: { type: "node", id },
        after: { type: "node", id },
      });
    }
  }
  const affectedSubjects: SubjectRef[] = [
    { type: "node", id: target.id },
    ...[...afterIds]
      .filter((id) => !beforeIds.has(id))
      .map((id) => ({ type: "node" as const, id })),
    ...[...beforeIds]
      .filter((id) => !afterIds.has(id))
      .map((id) => ({ type: "node" as const, id })),
  ];
  return { document: compiled, affectedSubjects, subjectMap };
}

/** Apply independent substitutions as one visible formula revision. */
export function substituteMany(
  document: FormalDocument,
  substitutions: Array<{ target: SubjectRef; binding: AuthoringTree }>,
): {
  document: FormalDocument;
  affectedSubjects: SubjectRef[];
  subjectMap: Array<{ before: SubjectRef; after: SubjectRef }>;
} {
  if (substitutions.length < 2 || substitutions.length > 8) {
    throw new DerivationError({
      code: "invalid_target",
      message: "substitute_many requires two to eight substitutions.",
    });
  }
  const targetIds = substitutions.map(({ target }) => {
    if (target.type !== "node") {
      throw new DerivationError({
        code: "invalid_target",
        message: "substitute_many requires node subjects.",
      });
    }
    return target.id;
  });
  if (new Set(targetIds).size !== targetIds.length) {
    throw new DerivationError({
      code: "invalid_target",
      message: "substitute_many targets must be distinct.",
    });
  }
  const originalIds = new Set(Object.keys(document.nodes));
  let nextDocument = document;
  const affectedSubjects: SubjectRef[] = [];
  for (const substitution of substitutions) {
    const replaced = replaceSubtree(
      nextDocument,
      substitution.target,
      substitution.binding,
    );
    nextDocument = replaced.document;
    affectedSubjects.push(...replaced.affectedSubjects);
  }
  nextDocument = {
    ...nextDocument,
    revision: document.revision + 1,
  };
  const finalIds = new Set(Object.keys(nextDocument.nodes));
  const subjectMap = [...originalIds]
    .filter((id) => finalIds.has(id))
    .map((id) => ({
      before: { type: "node" as const, id },
      after: { type: "node" as const, id },
    }));
  const uniqueAffected = new Map(
    affectedSubjects.map((subject) => [
      `${subject.type}:${subject.id}`,
      subject,
    ]),
  );
  return {
    document: nextDocument,
    affectedSubjects: [...uniqueAffected.values()],
    subjectMap,
  };
}

function findAuthoringNode(
  tree: AuthoringTree,
  targetId: string,
): AuthoringTree | undefined {
  if (tree.id === targetId) return tree;
  const children =
    tree.kind === "operator"
      ? tree.operands.map((operand) => operand.node)
      : tree.kind === "container"
        ? tree.slots.map((slot) => slot.node)
        : [];
  for (const child of children) {
    const found = findAuthoringNode(child, targetId);
    if (found) return found;
  }
  return undefined;
}

function swapAuthoringNodes(
  tree: AuthoringTree,
  leftId: string,
  rightId: string,
  left: AuthoringTree,
  right: AuthoringTree,
): AuthoringTree {
  if (tree.id === leftId) return structuredClone(right);
  if (tree.id === rightId) return structuredClone(left);
  if (tree.kind === "operator") {
    return {
      ...tree,
      operands: tree.operands.map((operand) => ({
        ...operand,
        node: swapAuthoringNodes(operand.node, leftId, rightId, left, right),
      })),
    };
  }
  if (tree.kind === "container") {
    return {
      ...tree,
      slots: tree.slots.map((slot) => ({
        ...slot,
        node: swapAuthoringNodes(slot.node, leftId, rightId, left, right),
      })),
    };
  }
  return structuredClone(tree);
}

/** Exchange two disjoint existing subtrees without changing either identity. */
export function swapSubtrees(
  document: FormalDocument,
  left: SubjectRef,
  right: SubjectRef,
): {
  document: FormalDocument;
  affectedSubjects: SubjectRef[];
  subjectMap: Array<{ before: SubjectRef; after: SubjectRef }>;
} {
  if (left.type !== "node" || right.type !== "node") {
    throw new DerivationError({
      code: "invalid_target",
      message: "swap_subtrees requires two node subjects.",
    });
  }
  if (left.id === right.id) {
    throw new DerivationError({
      code: "invalid_target",
      message: "swap_subtrees requires two different nodes.",
    });
  }
  const tree = decompileAuthoringTree(document);
  const leftTree = findAuthoringNode(tree, left.id);
  const rightTree = findAuthoringNode(tree, right.id);
  if (!leftTree || !rightTree) {
    throw new DerivationError({
      code: "missing_target",
      message: `Swap nodes ${left.id} and ${right.id} must both exist in the formula tree.`,
    });
  }
  if (
    authoringContainsId(leftTree, right.id) ||
    authoringContainsId(rightTree, left.id)
  ) {
    throw new DerivationError({
      code: "invalid_target",
      message: "swap_subtrees cannot exchange an ancestor with its descendant.",
    });
  }
  const nextTree = swapAuthoringNodes(
    tree,
    left.id,
    right.id,
    leftTree,
    rightTree,
  );
  const compiled = compileAuthoringTree(nextTree, document.id);
  compiled.revision = document.revision + 1;
  const subjectMap = Object.keys(document.nodes)
    .filter((id) => Boolean(compiled.nodes[id]))
    .map((id) => ({
      before: { type: "node" as const, id },
      after: { type: "node" as const, id },
    }));
  return {
    document: compiled,
    affectedSubjects: [left, right],
    subjectMap,
  };
}

export function setNodeAttribute(
  document: FormalDocument,
  target: SubjectRef,
  key: string,
  value: unknown,
): FormalDocument {
  if (target.type !== "node") {
    throw new DerivationError({
      code: "invalid_target",
      message: "subject.set_attribute requires a node subject.",
    });
  }
  const node = document.nodes[target.id];
  if (!node) {
    throw new DerivationError({
      code: "missing_target",
      message: `Node ${target.id} does not exist.`,
    });
  }
  const next: FormalDocument = structuredClone(document);
  const attributes = { ...(next.nodes[target.id].attributes ?? {}) };
  if (value === undefined || value === null) delete attributes[key];
  else attributes[key] = value as never;
  next.nodes[target.id] = { ...next.nodes[target.id], attributes };
  next.revision = document.revision + 1;
  return next;
}
