import type { components, operations } from "@xue-learn/core/source/src/shared/api/generated/api.ts";

export type UnitConceptMap = components["schemas"]["UnitConceptMap"];
export type UnitConceptMapNode = components["schemas"]["UnitConceptMapNode"];
export type UnitConceptMapEdge = components["schemas"]["UnitConceptMapEdge"];
export type GetUnitConceptMapResponse =
  operations["getUnitConceptMap"]["responses"][200]["content"]["application/json"];

export type UnitConceptMapNodeLayout = UnitConceptMapNode & {
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
};

export type UnitConceptMapLayout = {
  width: number;
  height: number;
  nodes: UnitConceptMapNodeLayout[];
};

export function unitConceptMapRelations(map: UnitConceptMap, nodeId: string) {
  return map.edges.filter(
    (edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId,
  );
}

export function connectedConceptNodeIds(
  map: UnitConceptMap,
  nodeId: string | null,
) {
  if (!nodeId) return new Set<string>();
  const ids = new Set([nodeId]);
  for (const edge of unitConceptMapRelations(map, nodeId)) {
    ids.add(edge.fromNodeId);
    ids.add(edge.toNodeId);
  }
  return ids;
}

export function conceptMapNodeById(map: UnitConceptMap) {
  return new Map(map.nodes.map((node) => [node.id, node]));
}

export function layoutUnitConceptMap(
  map: UnitConceptMap,
  requestedWidth: number,
): UnitConceptMapLayout {
  const width = Math.max(320, Math.floor(requestedWidth));
  const nodeIds = new Set(map.nodes.map((node) => node.id));
  const nodeOrder = new Map(map.nodes.map((node, index) => [node.id, index]));
  const outgoing = new Map<string, string[]>();
  const incomingCount = new Map(map.nodes.map((node) => [node.id, 0]));
  const layers = new Map(map.nodes.map((node) => [node.id, 0]));

  for (const edge of map.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) continue;
    outgoing.set(edge.fromNodeId, [
      ...(outgoing.get(edge.fromNodeId) ?? []),
      edge.toNodeId,
    ]);
    incomingCount.set(
      edge.toNodeId,
      (incomingCount.get(edge.toNodeId) ?? 0) + 1,
    );
  }

  const byOriginalOrder = (left: string, right: string) =>
    (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0);
  const queue = map.nodes
    .filter((node) => incomingCount.get(node.id) === 0)
    .map((node) => node.id)
    .sort(byOriginalOrder);
  const placed = new Set<string>();

  while (queue.length) {
    const id = queue.shift()!;
    if (placed.has(id)) continue;
    placed.add(id);
    for (const targetId of outgoing.get(id) ?? []) {
      layers.set(
        targetId,
        Math.max(layers.get(targetId) ?? 0, (layers.get(id) ?? 0) + 1),
      );
      const remaining = (incomingCount.get(targetId) ?? 1) - 1;
      incomingCount.set(targetId, remaining);
      if (remaining === 0) {
        queue.push(targetId);
        queue.sort(byOriginalOrder);
      }
    }
  }

  // Break cycles deterministically while preserving as much direction as possible.
  for (const node of map.nodes) {
    if (placed.has(node.id)) continue;
    const incomingLayers = map.edges
      .filter(
        (edge) =>
          edge.toNodeId === node.id &&
          edge.fromNodeId !== node.id &&
          placed.has(edge.fromNodeId),
      )
      .map((edge) => (layers.get(edge.fromNodeId) ?? 0) + 1);
    layers.set(node.id, Math.max(0, ...incomingLayers));
    placed.add(node.id);
  }

  const maximumLayer = 4;
  const grouped = new Map<number, UnitConceptMapNode[]>();
  for (const node of map.nodes) {
    const layer = Math.min(layers.get(node.id) ?? 0, maximumLayer);
    grouped.set(layer, [...(grouped.get(layer) ?? []), node]);
  }

  const layerNumbers = [...grouped.keys()].sort((left, right) => left - right);
  const orderedByLayer = new Map(
    layerNumbers.map((layer) => [
      layer,
      [...(grouped.get(layer) ?? [])].sort(
        (left, right) =>
          Number(right.isDirect) - Number(left.isDirect) ||
          (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0),
      ),
    ]),
  );
  const rebuildRanks = () => {
    const ranks = new Map<string, number>();
    for (const layer of layerNumbers) {
      for (const [index, node] of (orderedByLayer.get(layer) ?? []).entries()) {
        ranks.set(node.id, index);
      }
    }
    return ranks;
  };
  const barycenter = (
    nodeId: string,
    ranks: Map<string, number>,
    direction: "incoming" | "outgoing",
  ) => {
    const neighbours = map.edges
      .filter((edge) =>
        direction === "incoming"
          ? edge.toNodeId === nodeId
          : edge.fromNodeId === nodeId,
      )
      .map((edge) =>
        ranks.get(direction === "incoming" ? edge.fromNodeId : edge.toNodeId),
      )
      .filter((rank): rank is number => rank !== undefined);
    if (!neighbours.length) return null;
    return (
      neighbours.reduce((total, rank) => total + rank, 0) / neighbours.length
    );
  };

  // Alternating sweeps keep connected nodes near one another and reduce crossings.
  for (let sweep = 0; sweep < 2; sweep += 1) {
    let ranks = rebuildRanks();
    for (const layer of layerNumbers.slice(1)) {
      orderedByLayer.get(layer)?.sort((left, right) => {
        const leftCenter = barycenter(left.id, ranks, "incoming");
        const rightCenter = barycenter(right.id, ranks, "incoming");
        if (leftCenter !== null && rightCenter !== null) {
          return (
            leftCenter - rightCenter ||
            (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
          );
        }
        if (leftCenter !== null) return -1;
        if (rightCenter !== null) return 1;
        return (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0);
      });
      ranks = rebuildRanks();
    }

    ranks = rebuildRanks();
    for (const layer of [...layerNumbers].reverse().slice(1)) {
      orderedByLayer.get(layer)?.sort((left, right) => {
        const leftCenter = barycenter(left.id, ranks, "outgoing");
        const rightCenter = barycenter(right.id, ranks, "outgoing");
        if (leftCenter !== null && rightCenter !== null) {
          return (
            leftCenter - rightCenter ||
            (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0)
          );
        }
        if (leftCenter !== null) return -1;
        if (rightCenter !== null) return 1;
        return (nodeOrder.get(left.id) ?? 0) - (nodeOrder.get(right.id) ?? 0);
      });
      ranks = rebuildRanks();
    }
  }

  const narrow = width < 480;
  const sidePadding = narrow ? 8 : width < 720 ? 16 : 24;
  const columnGap = narrow ? 10 : width < 720 ? 14 : 20;
  const columns = width < 720 ? 2 : 3;
  const usableWidth = width - sidePadding * 2;
  const nodeWidth = Math.min(
    220,
    Math.floor((usableWidth - columnGap * (columns - 1)) / columns),
  );
  const nodeHeight = narrow ? 88 : 76;
  const rowGap = narrow ? 58 : 66;
  const visualRows: Array<{ layer: number; nodes: UnitConceptMapNode[] }> = [];

  for (const layer of layerNumbers) {
    const ordered = orderedByLayer.get(layer) ?? [];
    for (let index = 0; index < ordered.length; index += columns) {
      visualRows.push({ layer, nodes: ordered.slice(index, index + columns) });
    }
  }

  const nodes = visualRows.flatMap((row, rowIndex) => {
    const rowWidth =
      row.nodes.length * nodeWidth +
      Math.max(0, row.nodes.length - 1) * columnGap;
    const rowStart = Math.round((width - rowWidth) / 2);
    return row.nodes.map((node, column) => ({
      ...node,
      x: rowStart + column * (nodeWidth + columnGap),
      y: 24 + rowIndex * (nodeHeight + rowGap),
      width: nodeWidth,
      height: nodeHeight,
      layer: row.layer,
    }));
  });

  return {
    width,
    height: Math.max(
      24 +
        Math.max(1, visualRows.length) * nodeHeight +
        Math.max(0, visualRows.length - 1) * rowGap +
        24,
      180,
    ),
    nodes,
  };
}
