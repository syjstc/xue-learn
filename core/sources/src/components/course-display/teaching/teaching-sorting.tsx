import {TeachingFocus} from "./teaching-focus.js";
import React from "react";
import {materialTeachingSortOperations} from "../../../../libs/domain/src/index.js";
import type {MaterialTeachingSample} from "../../../../libs/domain/src/index.js";
import {Diagram, Label, TextBox, T, tint, ease} from "./templates/primitives.js";

/** Compare and swap are separate semantic states. No elapsed time can select a
 * later operation: only the accepted cue can change the active operation. */
export function TeachingSortingArt({values, sample}: {values: readonly number[]; sample: MaterialTeachingSample}) {
  const operations = materialTeachingSortOperations(values);
  const operation = operations.find(item => item.id === sample.stepId) ?? operations[0]!;
  const fraction = operation.kind === "swap" ? ease(sample.progress) : 0;
  const width = 720 / values.length, maximum = Math.max(...values, 1);
  const selected = new Set(operation.kind === "compare" || operation.kind === "swap" ? operation.sourceItemIds : []);
  const shown = operation.kind === "swap" && fraction >= 1 ? operation.after : operation.before;
  return <Diagram label="插入排序的逐次比较与交换">
    <g data-teaching-sort-operation={operation.id} data-teaching-sort-values={shown.values.join(",")} data-teaching-sort-order={shown.order.join(",")}>
      <TextBox x={70} y={28} width={860} height={80} text={sample.stepId ? operation.label : "观察输入中的数值与原始顺序"} size={23} lineHeight={29}/>
      <line x1={139} x2={861} y1={359} y2={359} stroke={T.border} strokeWidth={2}/>
      {values.map((value, id) => {
        const from = operation.before.order.indexOf(id), to = operation.after.order.indexOf(id);
        const x = 140 + width * (.5 + from + (to - from) * fraction);
        const lift = operation.kind === "swap" && from !== to ? Math.sin(Math.PI * fraction) * (to < from ? 26 : -16) : 0;
        const height = value / maximum * 200, active = selected.has(`value-${id + 1}`);
        return <g key={id} data-teaching-sort-item={`value-${id + 1}`} data-teaching-sort-selected={active} transform={`translate(${x},${-lift})`}>
          <rect x={-width * .3} y={358 - height} width={width * .6} height={Math.max(2, height)} rx={10} fill={tint(active ? T.caution : T.accent, active ? .3 : .16)} stroke={active ? T.caution : T.accent} strokeWidth={3}/>
          <TeachingFocus id={`value-${id + 1}`} operations={operation.sourceItemIds.includes(`value-${id + 1}`) ? [operation.id] : []} x={-width * .3 - 5} y={310 - height} width={width * .6 + 10} height={height + 53} color={active ? T.caution : T.accent}/>
          <Label x={0} y={338 - height} size={27} color={active ? T.cautionText : T.accentText}>{value}</Label>
        </g>;
      })}
      {values.map((_, index) => <Label key={index} x={140 + width * (index + .5)} y={395} size={17} color={T.muted}>{`[${index}]`}</Label>)}
      <TextBox x={70} y={425} width={860} height={58} text={operation.kind === "complete" ? `完成：${operation.after.values.join(" ≤ ")}` : operation.kind === "compare" ? "先比较两个值；只有下一步明确要求交换时，位置才改变。" : "数值和对象身份保持不变。"} size={18} lineHeight={23} color={T.muted} weight={450}/>
    </g>
  </Diagram>;
}
