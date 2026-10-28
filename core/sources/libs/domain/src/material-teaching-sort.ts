export type TeachingSortState = {values: number[]; order: number[]; swap: [number, number] | null};
export type TeachingSortOperation = {
  id: string; kind: "observe" | "compare" | "swap" | "complete"; label: string;
  before: TeachingSortState; after: TeachingSortState; indices?: readonly [number, number];
  sourceItemIds: string[];
};
/** Comparisons are observable operations even when no swap follows. This trace
 * is also the renderer's state, so narration can never fabricate a swap. */
export function materialTeachingSortOperations(input: readonly number[]): TeachingSortOperation[] {
  const values = [...input], order = input.map((_, index) => index);
  const state = (): TeachingSortState => ({values: [...values], order: [...order], swap: null});
  const operations: TeachingSortOperation[] = [{id: "values", kind: "observe", label: "观察待排序值与原始顺序", before: state(), after: state(), sourceItemIds: order.map(id => `value-${id + 1}`)}];
  let comparison = 0;
  for (let i = 1; i < values.length; i++) for (let j = i; j > 0; j--) {
    const before = state(), indices = [j - 1, j] as const;
    const sourceItemIds = indices.map(index => `value-${order[index]! + 1}`);
    const swap = values[j - 1]! > values[j]!;
    comparison++;
    operations.push({id: `compare-${comparison}`, kind: "compare", label: `比较 ${values[j - 1]} 与 ${values[j]}：${swap ? "左大右小，需要交换" : "顺序正确，无须交换"}`, before, after: state(), indices, sourceItemIds});
    if (!swap) break;
    [values[j - 1], values[j]] = [values[j]!, values[j - 1]!];
    [order[j - 1], order[j]] = [order[j]!, order[j - 1]!];
    operations.push({id: `swap-${comparison}`, kind: "swap", label: `交换刚才比较的 ${before.values[j - 1]} 与 ${before.values[j]}`, before, after: {...state(), swap: [j - 1, j]}, indices, sourceItemIds});
  }
  operations.push({id: "sorted", kind: "complete", label: "核对最终顺序与数值守恒", before: state(), after: state(), sourceItemIds: order.map(id => `value-${id + 1}`)});
  return operations;
}
/** Values are executed by the host; original indices preserve equal items. */
export function materialTeachingSortTrace(input: readonly number[]): TeachingSortState[] {
  const values = [...input], order = input.map((_, index) => index);
  const trace: TeachingSortState[] = [{values: [...values], order: [...order], swap: null}];
  for (let i = 1; i < values.length; i++) for (let j = i; j > 0 && values[j - 1]! > values[j]!; j--) {
    [values[j - 1], values[j]] = [values[j]!, values[j - 1]!];
    [order[j - 1], order[j]] = [order[j]!, order[j - 1]!];
    trace.push({values: [...values], order: [...order], swap: [j - 1, j]});
  }
  return trace;
}
