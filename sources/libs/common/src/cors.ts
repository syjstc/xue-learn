import type { INestApplication } from "@nestjs/common";

const defaultExactOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://cardisget.top",
  "https://learn-test.cardisget.top",
  "https://xue-learn.com",
];

/** Built-in production / staging host patterns (also overridable via env). */
const defaultOriginPatterns = [
  "https://*.xue-learn.com",
  "https://*.cardisget.top",
];

function isLocalDevOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (!["http:", "https:"].includes(url.protocol)) return false;

    const host = url.hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(host) ||
      /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
    );
  } catch {
    return false;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** Convert a CORS pattern with `*` wildcards into a case-insensitive regex. */
function wildcardPatternToRegExp(pattern: string): RegExp {
  const parts = pattern.split("*").map(escapeRegex);
  // Each `*` matches one DNS label (e.g. www), not nested subdomains or `/`.
  return new RegExp(`^${parts.join("[^.]+")}$`, "i");
}

/**
 * Match an Origin against an allowlist entry.
 * Supports exact origins and wildcards:
 * - `https://www.xue-learn.com` (exact)
 * - `https://*.xue-learn.com` (scheme + single subdomain label)
 * - `*.xue-learn.com` (any http/https origin for that host pattern)
 */
export function matchesCorsOriginPattern(
  origin: string,
  pattern: string,
): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;

  if (!trimmed.includes("*")) {
    return origin === trimmed;
  }

  // Host-only pattern: *.xue-learn.com
  if (!trimmed.includes("://")) {
    try {
      const url = new URL(origin);
      if (!["http:", "https:"].includes(url.protocol)) return false;
      return wildcardPatternToRegExp(trimmed).test(url.hostname);
    } catch {
      return false;
    }
  }

  return wildcardPatternToRegExp(trimmed).test(origin);
}

function isAllowedCorsOrigin(
  origin: string | undefined,
  extraOrigins: string[],
): boolean {
  if (!origin) return true;
  if (isLocalDevOrigin(origin) || defaultExactOrigins.includes(origin)) {
    return true;
  }
  const patterns = [...defaultOriginPatterns, ...extraOrigins];
  return patterns.some((pattern) => matchesCorsOriginPattern(origin, pattern));
}

/** CORS for API gateway and direct-facing Nest services in local dev. */
export function configureAppCors(app: INestApplication): void {
  const extraOrigins = (process.env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      if (isAllowedCorsOrigin(origin, extraOrigins)) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Accept",
      "Accept-Language",
      "Authorization",
      "X-Requested-With",
      "Cache-Control",
    ],
    exposedHeaders: ["Content-Type", "Cache-Control"],
  });
}

/** Strip upstream CORS headers so the gateway remains the single CORS authority. */
export function stripUpstreamCorsHeaders(
  headers: Record<string, unknown>,
): Record<string, string | string[]> {
  const blocked = new Set([
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-headers",
    "access-control-allow-methods",
    "access-control-expose-headers",
    "access-control-max-age",
    "transfer-encoding",
  ]);

  const out: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined || blocked.has(key.toLowerCase())) continue;
    out[key] = value as string | string[];
  }
  return out;
}
