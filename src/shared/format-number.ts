/** Shared formatting for nonnegative host-supplied estimates. */
export function formatGenerationEstimate(value: number): string {
  const rounded = Math.round(Math.max(0, value) * 100) / 100;
  return new Intl.NumberFormat(undefined, {minimumFractionDigits: 0, maximumFractionDigits: 2}).format(rounded);
}
