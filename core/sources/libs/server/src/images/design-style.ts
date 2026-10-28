/**
 * Light-theme design tokens mirrored from src/shared/design-tokens.json.
 * Raster illustrations are fixed pixels with no dark variant, so every image
 * prompt pins the light theme. scripts/check-design-tokens.mjs keeps these
 * values synchronized with the canonical JSON.
 */
export const IMAGE_DESIGN_TOKENS = {
  background: '#FAF7F4',
  canvas: '#F5F0EB',
  surfaceInset: '#EDE7E0',
  primaryContainer: '#FDF5F4',
  border: '#DDD5CB',
  borderLight: '#E8E2DA',
  ink: '#3E3632',
  muted: '#7A6F65',
  primary: '#C25B56',
  primaryDark: '#A84843',
  success: '#6BAF7C',
  warning: '#D4A03C',
  info: '#5B8FB9',
} as const;

const {
  background,
  canvas,
  surfaceInset,
  primaryContainer,
  border,
  borderLight,
  ink,
  muted,
  primary,
  primaryDark,
  success,
  warning,
  info,
} = IMAGE_DESIGN_TOKENS;

const PALETTE_COLORS = `warm charcoal ${ink} for text and principal line work; ${muted} for quiet secondary labels; hairline borders and guides ${border} / ${borderLight}; one warm terracotta accent ${primary} (deep ${primaryDark}) reserved for the single teaching focus — the key curve, the highlighted term, or the primary arrow path — with ${primaryContainer} as its soft tint fill; semantic colors only when they carry meaning: success ${success}, warning ${warning}, informational blue ${info}. Do not introduce any other hues, neon or dark-tech palettes, rainbow color variety, or busy gradients.`;

const PALETTE_RULE = `Color palette (fixed product style, XueLearn light classroom theme; do not restyle): warm paper background ${background} with ${canvas} for large quiet zones and ${surfaceInset} for inset panels or grouping surfaces; ${PALETTE_COLORS}`;

const TRANSPARENT_PALETTE_RULE = `Color palette (fixed product style, XueLearn light classroom theme; do not restyle): the canvas itself is fully transparent — do not paint any background fill; ${PALETTE_COLORS}`;

const RENDERING_RULE = `Rendering style: flat, clean, textbook-quality educational vector illustration; simple geometric shapes with soft warm tinted fills, thin uniform strokes, rounded corners; generous whitespace, balanced composition, and clear visual hierarchy; no photorealism, no 3D render, no chalk or hand-drawn sketch texture, no decorative clutter, no drop shadows on the paper.`;

const FORMULA_RULE = `Formulas and equations: typeset like standard LaTeX math on the paper — italic Latin variables, upright numbers and operators, thin fraction bars, properly drawn radical overbars; render formulas in ${ink} and reserve the accent for at most one highlighted term; never handwriting, chalk texture, or decorative display fonts.`;

const COORDINATE_RULE = `Coordinate systems and plots: a rectangular plot region with thin ${ink} axes and small arrowheads; grid lines in ${borderLight} behind the data; axis numbers and ticks in ${muted}; curves, points, and bars only in the accent and semantic palette above, at most four series; keep legends or endpoint callouts outside the data area with clear margins so no label is clipped.`;

const DIAGRAM_RULE = `Diagrams: nodes as rounded rectangles or simple geometric shapes with warm tinted fills and thin ${border} borders; arrows start at and land exactly on their intended targets with small solid heads in ${ink} or ${muted}; show grouping with soft tinted regions; keep every label short and never overlapping shapes, lines, arrows, or other text.`;

const CANVAS_RULE = `Canvas: fill the entire frame edge-to-edge on the warm paper background. Do not draw an outer white poster card, rounded-rect frame, drop shadow, corner badge, or any AI-generated watermark.`;

const TRANSPARENT_CANVAS_RULE = `Canvas: isolate the subject on a fully transparent background with a real alpha channel (PNG transparency) — do not paint any background color, paper, wall, floor, table, or scene environment behind the subject; no poster card, rounded-rect frame, drop shadow, corner badge, or watermark; let the subject itself fill the frame.`;

/**
 * The single shared style contract appended to every image generation prompt,
 * so authored illustration blocks, SVG→raster conversions, regenerations, and
 * no-text scene illustrations all render in the same light-theme look.
 * Providers that can emit alpha pass `transparent` to isolate the subject;
 * the paper canvas stays as the fallback for providers that reject it.
 */
export function imageStyleContract(options?: {
  noText?: boolean;
  transparent?: boolean;
}): string {
  const palette = options?.transparent ? TRANSPARENT_PALETTE_RULE : PALETTE_RULE;
  const canvas = options?.transparent ? TRANSPARENT_CANVAS_RULE : CANVAS_RULE;
  if (options?.noText) {
    return `${palette} ${RENDERING_RULE} ${canvas}`;
  }
  return `${palette} ${RENDERING_RULE} ${FORMULA_RULE} ${COORDINATE_RULE} ${DIAGRAM_RULE} ${canvas}`;
}
