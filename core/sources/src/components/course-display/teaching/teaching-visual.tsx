import React from "react";
import {materialVisualTarget, type MaterialVisual} from "../../../../libs/domain/src/index.js";
import {LayersScene, FlowScene} from "./templates/general-scenes.js";
import "./templates/templates.css";

/** Ordinary visuals keep their original IDs, copy and bottom-to-top layer order.
 * Rich Markdown remains with the existing renderer that owns that syntax. */
export function supportsTeachingVisualArt(block: MaterialVisual): boolean {
  return ["layers", "process"].includes(block.kind) && block.items.length >= 2 && block.items.length <= 5
    && [block.title, ...block.items.flatMap(item => [item.label, item.detail ?? ""])].every(text => !/[$*_`\[\]<>]|\\[()[\]]/.test(text));
}
export function TeachingVisualArt({block, emphasis, motionSeconds}: {block: MaterialVisual; emphasis: readonly number[]; motionSeconds?: number}) {
  const target = (index: number) => materialVisualTarget(block.id, block.items[index]!.id);
  if (block.kind === "layers") {
    // Existing visual contracts list the foundation first; the renderer paints
    // rows from top to bottom, so reverse only this view, never saved content.
    const ordered = block.items.map((item, index) => ({item, index})).reverse();
    return <LayersScene frame={360} fps={60} structureProgress={1}
      content={{layers: ordered.map(({item}) => ({title: item.label, detail: item.detail ?? ""}))}}
      itemTargetIds={ordered.map(({index}) => target(index))}
      layerMotion={{layers: ordered.map(({index}, row) => ({id: `layer-${row + 1}`, reveal: 1, focus: emphasis[index] ?? 0}))}}/>;
  }
  return <FlowScene frame={420} fps={60} content={{nodes: block.items.map(item => item.label), caption: ""}}
    motionSeconds={motionSeconds}
    details={block.items.map(item => item.detail ?? "")}
    itemTargetIds={block.items.map((_, index) => target(index))}
    itemMotion={block.items.map((_, index) => ({id: `node-${index + 1}`, reveal: 1, focus: emphasis[index] ?? 0}))}/>;
}
