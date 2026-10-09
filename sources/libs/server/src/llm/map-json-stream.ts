import {
  decomposeUnitSchema,
  type DecomposeResult,
} from "./schemas.js";

export type MapJsonPartial = {
  map: DecomposeResult;
  unitCount: number;
  placeholderUnitCount: number;
};

const DOMAIN_TAGS = new Set(["stem", "humanities", "general"]);

function domainTagFrom(value: unknown): DecomposeResult["domainTag"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "general";
  }
  const tag = (value as Record<string, unknown>).domainTag;
  return typeof tag === "string" && DOMAIN_TAGS.has(tag)
    ? (tag as DecomposeResult["domainTag"])
    : "general";
}

function partialFromValue(value: unknown): MapJsonPartial | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const rawUnits = Array.isArray(record.units) ? record.units : [];
  const units = rawUnits.flatMap((unit) => {
    const parsed = decomposeUnitSchema.safeParse(unit);
    return parsed.success ? [parsed.data] : [];
  });
  if (!("domainTag" in record) && !("units" in record)) return null;
  return {
    map: { domainTag: domainTagFrom(record), units },
    unitCount: units.length,
    placeholderUnitCount: Math.max(0, rawUnits.length - units.length),
  };
}

/**
 * Extract complete unit objects from an unfinished structured JSON response.
 * Strings and escaped quotes are tracked so braces in generated text are safe.
 */
function parseIncompleteMapJson(text: string): MapJsonPartial | null {
  const domainMatch = text.match(
    /"domainTag"\s*:\s*"(stem|humanities|general)"/,
  );
  const unitsKey = text.search(/"units"\s*:/);
  if (unitsKey < 0) {
    return domainMatch
      ? {
          map: {
            domainTag: domainMatch[1] as DecomposeResult["domainTag"],
            units: [],
          },
          unitCount: 0,
          placeholderUnitCount: 0,
        }
      : null;
  }
  const arrayStart = text.indexOf("[", unitsKey);
  if (arrayStart < 0) return null;

  const units: DecomposeResult["units"] = [];
  let objectStart = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < text.length; index += 1) {
    const char = text[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }
    if (char !== "}" || depth === 0) continue;
    depth -= 1;
    if (depth !== 0 || objectStart < 0) continue;
    try {
      const parsed = decomposeUnitSchema.safeParse(
        JSON.parse(text.slice(objectStart, index + 1)),
      );
      if (parsed.success) units.push(parsed.data);
    } catch {
      // A complete-looking but invalid item remains a preview placeholder.
    }
    objectStart = -1;
  }

  return {
    map: {
      domainTag: (domainMatch?.[1] ??
        "general") as DecomposeResult["domainTag"],
      units,
    },
    unitCount: units.length,
    placeholderUnitCount: depth > 0 ? 1 : 0,
  };
}

export class MapJsonStreamAccumulator {
  private text = "";
  private lastSnapshot = "";

  private emit(partial: MapJsonPartial | null): MapJsonPartial | null {
    if (!partial) return null;
    const snapshot = JSON.stringify(partial);
    if (snapshot === this.lastSnapshot) return null;
    this.lastSnapshot = snapshot;
    return partial;
  }

  append(delta: string): MapJsonPartial | null {
    this.text += delta;
    try {
      return this.emit(partialFromValue(JSON.parse(this.text)));
    } catch {
      return this.emit(parseIncompleteMapJson(this.text));
    }
  }

  appendValue(value: unknown): MapJsonPartial | null {
    return this.emit(partialFromValue(value));
  }

  reset(): void {
    this.text = "";
    this.lastSnapshot = "";
  }
}
