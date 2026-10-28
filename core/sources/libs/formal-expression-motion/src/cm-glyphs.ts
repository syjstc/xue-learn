/**
 * Computer Modern outlines from KaTeX (1000 units = 1 em).
 *
 * Parentheses: `tallDelim` paths from katex/src/svgGeometry.ts (Size4 hooks
 * plus a curved recipe, not a straight pipe). Integrals: Size2-Regular U+222B;
 * nested growth translates the teardrop terminals and only lengthens the stem.
 */

export const CM_UNIT = 1000;

/** KaTeX stacked paren: top + bottom Size4 pieces, each 1.8 em. */
const TALL_PAREN_MIN = 1.8 + 1.8;
const TALL_PAREN_ADVANCE = 875;

export const SIZE4_PAREN_NATIVE = 1750 + 1249;
export const SIZE4_PAREN_WAIST = 251;
export const SIZE4_PAREN_ADVANCE = 792;
export const SIZE2_INT_NATIVE = 1360 + 862;
export const SIZE2_INT_AXIS = 250;
export const SIZE2_INT_WIDTH = 944 - 55;
export const SIZE2_INT_HEIGHT = 1360;
export const SIZE2_INT_DEPTH = 862;

const SIZE2_INTEGRAL =
  "M167 -741Q167 -784 114 -798Q116 -801 120 -804Q139 -824 165 -824Q178 -825 192 -812Q243 -761 296 -511Q324 -381 367 -133Q457 397 591 934Q613 1018 624.5 1059Q636 1100 659 1166.5Q682 1233 707.5 1273.5Q733 1314 764 1336Q797 1360 828 1360Q879 1360 910 1327Q941 1294 944 1245Q944 1217 929 1200Q914 1183 887 1183Q864 1183 848 1199Q832 1215 832 1239Q832 1282 885 1296L882 1300Q879 1303 874 1307Q869 1311 866 1313Q851 1323 833 1323Q828 1323 826 1322Q794 1313 761 1222Q728 1132 688 929Q658 783 633 628Q537 79 409 -435Q377 -562 355 -629Q318 -741 274 -799Q229 -862 165 -862Q120 -862 88.5 -828Q57 -794 55 -746Q55 -718 70 -701.5Q85 -685 112 -685Q135 -685 151 -701Q167 -717 167 -741Z";

export function cmParenPath(
  side: "left" | "right",
  extent: number,
  em: number,
): string {
  const { sx, sy, mid } = tallParenStretch(extent, em);
  const template = side === "left" ? tallLeftParen(mid) : tallRightParen(mid);
  const span = TALL_PAREN_MIN + mid / CM_UNIT;
  const height = ((span * sy) / 2 + 0.25) * em;
  const yScale = (em / CM_UNIT) * sy;
  const xScale = (em / CM_UNIT) * sx;
  return mapKatexPath(template, (x, y) => ({
    x: x * xScale,
    y: y * yScale - height,
  }));
}

export function cmBracketPath(
  side: "left" | "right",
  extent: number,
  em: number,
): string {
  const { sx, sy, gap } = size4Stretch(extent, em);
  const u = em / CM_UNIT;
  const X = (x: number) => (x * sx * u).toFixed(2);
  const Y = (y: number) => {
    const shifted =
      y + (y > SIZE4_PAREN_WAIST ? gap : y < SIZE4_PAREN_WAIST ? -gap : 0);
    return (
      -(SIZE4_PAREN_WAIST + (shifted - SIZE4_PAREN_WAIST) * sy) * u
    ).toFixed(2);
  };
  if (side === "left") {
    return `M ${X(269)} ${Y(-1249)} V ${Y(1750)} H ${X(577)} V ${Y(1677)} H ${X(342)} V ${Y(-1176)} H ${X(577)} V ${Y(-1249)} Z`;
  }
  return `M ${X(5)} ${Y(1677)} V ${Y(1750)} H ${X(313)} V ${Y(-1249)} H ${X(5)} V ${Y(-1176)} H ${X(240)} V ${Y(1677)} Z`;
}

export function cmIntegralPath(extent: number, em: number): string {
  const native = (SIZE2_INT_NATIVE / CM_UNIT) * em;
  const sy = native > 0 ? Math.max(extent, 0.85 * em) / native : 1;
  const scale = em / CM_UNIT;
  const tokens = SIZE2_INTEGRAL.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let vertical = false;
  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      out.push(token);
      vertical = false;
      continue;
    }
    const value = Number(token);
    if (vertical) {
      out.push((-stretchIntegralY(value, sy) * scale).toFixed(2));
    } else {
      out.push(((value - 55) * scale).toFixed(2));
    }
    vertical = !vertical;
  }
  return out.join(" ");
}

export function cmParenWidth(extent: number, em: number): number {
  return (TALL_PAREN_ADVANCE / CM_UNIT) * em * tallParenStretch(extent, em).sx;
}

export function cmBracketWidth(extent: number, em: number): number {
  return 0.667 * em * size4Stretch(extent, em).sx;
}

export function cmIntegralWidth(em: number): number {
  return (SIZE2_INT_WIDTH / CM_UNIT) * em;
}

function tallParenStretch(extent: number, em: number): {
  sx: number;
  sy: number;
  mid: number;
} {
  const span = Math.max(extent / em, 0.9);
  const grow = Math.max(0, span - TALL_PAREN_MIN);
  const shrink = Math.min(1, span / TALL_PAREN_MIN);
  const sx = Math.max(shrink, 0.56) * (1 + 0.035 * Math.min(grow, 2.2));
  return {
    sx,
    sy: grow > 0 ? 1 : shrink,
    mid: grow * CM_UNIT,
  };
}

function size4Stretch(extent: number, em: number): {
  sx: number;
  sy: number;
  gap: number;
} {
  const native = (SIZE4_PAREN_NATIVE / CM_UNIT) * em;
  const grow = Math.max(0, extent - native);
  const shrink = native > 0 ? Math.min(1, Math.max(extent, 0.9 * em) / native) : 1;
  return {
    sx: Math.max(shrink, 0.52),
    sy: grow > 0 ? 1 : shrink,
    gap: ((grow / em) * CM_UNIT) / 2,
  };
}

/** Keep CM teardrops; only the S-stem lengthens. */
function stretchIntegralY(y: number, sy: number): number {
  const top = 1080;
  const bot = -640;
  const axis = SIZE2_INT_AXIS;
  if (y >= top) return axis + (top - axis) * sy + (y - top);
  if (y <= bot) return axis + (bot - axis) * sy + (y - bot);
  return axis + (y - axis) * sy;
}

function tallLeftParen(mid: number): string {
  return `M863,9c0,-2,-2,-5,-6,-9c0,0,-17,0,-17,0c-12.7,0,-19.3,0.3,-20,1c-5.3,5.3,-10.3,11,-15,17c-242.7,294.7,-395.3,682,-458,1162c-21.3,163.3,-33.3,349,-36,557l0,${mid + 84}c0.2,6,0,26,0,60c2,159.3,10,310.7,24,454c53.3,528,210,949.7,470,1265c4.7,6,9.7,11.7,15,17c0.7,0.7,7,1,19,1c0,0,18,0,18,0c4,-4,6,-7,6,-9c0,-2.7,-3.3,-8.7,-10,-18c-135.3,-192.7,-235.5,-414.3,-300.5,-665c-65,-250.7,-102.5,-544.7,-112.5,-882c-2,-104,-3,-167,-3,-189l0,-${mid + 92}c0,-162.7,5.7,-314,17,-454c20.7,-272,63.7,-513,129,-723c65.3,-210,155.3,-396.3,270,-559c6.7,-9.3,10,-15.3,10,-18z`;
}

function tallRightParen(mid: number): string {
  return `M76,0c-16.7,0,-25,3,-25,9c0,2,2,6.3,6,13c21.3,28.7,42.3,60.3,63,95c96.7,156.7,172.8,332.5,228.5,527.5c55.7,195,92.8,416.5,111.5,664.5c11.3,139.3,17,290.7,17,454c0,28,1.7,43,3.3,45l0,${mid + 9}c-3,4,-3.3,16.7,-3.3,38c0,162,-5.7,313.7,-17,455c-18.7,248,-55.8,469.3,-111.5,664c-55.7,194.7,-131.8,370.3,-228.5,527c-20.7,34.7,-41.7,66.3,-63,95c-2,3.3,-4,7,-6,11c0,7.3,5.7,11,17,11c0,0,11,0,11,0c9.3,0,14.3,-0.3,15,-1c5.3,-5.3,10.3,-11,15,-17c242.7,-294.7,395.3,-681.7,458,-1161c21.3,-164.7,33.3,-350.7,36,-558l0,-${mid + 144}c-2,-159.3,-10,-310.7,-24,-454c-53.3,-528,-210,-949.7,-470,-1265c-4.7,-6,-9.7,-11.7,-15,-17c-0.7,-0.7,-6.7,-1,-18,-1z`;
}

function mapKatexPath(
  d: string,
  map: (x: number, y: number) => { x: number; y: number },
): string {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let command = "";
  let nums: number[] = [];
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  const flush = () => {
    if (!command) return;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    if (upper === "Z") {
      out.push("Z");
      x = startX;
      y = startY;
      nums = [];
      return;
    }
    const mapped: number[] = [];
    let i = 0;
    const pointTo = (nx: number, ny: number) => {
      const point = map(nx, ny);
      x = nx;
      y = ny;
      mapped.push(point.x, point.y);
    };
    if (upper === "H") {
      while (i < nums.length) {
        const nx = relative ? x + nums[i] : nums[i];
        i += 1;
        pointTo(nx, y);
      }
      out.push(`L ${fmtPairs(mapped)}`);
    } else if (upper === "V") {
      while (i < nums.length) {
        const ny = relative ? y + nums[i] : nums[i];
        i += 1;
        pointTo(x, ny);
      }
      out.push(`L ${fmtPairs(mapped)}`);
    } else if (upper === "C" || upper === "Q") {
      const arity = upper === "C" ? 6 : 4;
      while (i + arity - 1 < nums.length) {
        const originX = x;
        const originY = y;
        const slice: number[] = [];
        for (let k = 0; k < arity; k += 2) {
          const nx = relative ? originX + nums[i] : nums[i];
          const ny = relative ? originY + nums[i + 1] : nums[i + 1];
          i += 2;
          const point = map(nx, ny);
          slice.push(point.x, point.y);
          if (k === arity - 2) {
            x = nx;
            y = ny;
          }
        }
        out.push(`${upper} ${fmtPairs(slice)}`);
      }
    } else {
      while (i + 1 < nums.length) {
        const nx = relative ? x + nums[i] : nums[i];
        const ny = relative ? y + nums[i + 1] : nums[i + 1];
        i += 2;
        pointTo(nx, ny);
      }
      out.push(`${upper} ${fmtPairs(mapped)}`);
    }
    if (upper === "M") {
      startX = x;
      startY = y;
    }
    nums = [];
  };

  for (const token of tokens) {
    if (/^[A-Za-z]$/.test(token)) {
      flush();
      command = token;
      continue;
    }
    nums.push(Number(token));
  }
  flush();
  return out.join("");
}

function fmtPairs(nums: number[]): string {
  return nums.map((n) => n.toFixed(2)).join(" ");
}
