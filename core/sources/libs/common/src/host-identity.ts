type Headers = Record<string, string | string[] | undefined>;
export type RequestIdentityResolver = (headers: Headers) => string | undefined;
let resolver: RequestIdentityResolver | null = null;
/** Ingress owns authentication and removes untrusted identity headers before Core owner checks. */
export function configureRequestIdentityResolver(value: RequestIdentityResolver | null): void { resolver = value; }
export function resolveHostRequestUserId(headers: Headers): string | undefined {
 const raw = headers["x-user-id"];
 if (raw) return Array.isArray(raw) ? raw[0] : raw;
 try { const value = resolver?.(headers); return typeof value === "string" ? value : undefined; } catch { return undefined; }
}
