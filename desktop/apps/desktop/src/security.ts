import type { BrowserWindow, Session } from "electron";
import {
  classifyPersonalSyncLeaseRequest,
  type PersonalSyncLeaseTarget,
} from "@xue-learn/core/runtime-contracts";
import { INTERACTIVE_HTML_SCHEME } from "./interactive-html-store.ts";


export const DESKTOP_CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  `frame-src 'self' ${INTERACTIVE_HTML_SCHEME}:`,
  "form-action 'self'",
  "script-src 'self' 'wasm-unsafe-eval' xuelearn-plugin:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline' xuelearn-plugin:",
  "img-src 'self' data: blob: xuelearn-plugin:",
  "font-src 'self' data: xuelearn-plugin:",
  "media-src 'self' blob: xuelearn-plugin:",
  "connect-src 'self' xuelearn-plugin:",
].join("; ");

export function isExactLoopbackOrigin(candidate: string, baseUrl: string): boolean {
  try {
    const candidateUrl = new URL(candidate);
    const base = new URL(baseUrl);
    return (
      base.protocol === "http:" &&
      base.hostname === "127.0.0.1" &&
      candidateUrl.origin === base.origin
    );
  } catch {
    return false;
  }
}

export function withSessionAuthorization(
  requestUrl: string,
  headers: Record<string, string>,
  session: { baseUrl: string; token: string } | null,
  extraOrigins: readonly string[] = [],
): Record<string, string> {
  if (!session) return headers;
  const allowed = [session.baseUrl, ...extraOrigins];
  if (!allowed.some((origin) => isExactLoopbackOrigin(requestUrl, origin))) {
    return headers;
  }
  const clean = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"));
  return { ...clean, Authorization: `Bearer ${session.token}` };
}

export function classifyLocalPersonalSyncLeaseRequest(
  method: string,
  requestUrl: string,
  sidecarBaseUrl: string | null,
  extraOrigins: readonly string[] = [],
): PersonalSyncLeaseTarget | null {
  if (!sidecarBaseUrl) return null;
  const allowed = [sidecarBaseUrl, ...extraOrigins].some((origin) =>
    isExactLoopbackOrigin(requestUrl, origin),
  );
  if (!allowed) return null;
  return classifyPersonalSyncLeaseRequest(method, new URL(requestUrl).pathname);
}

export function installSessionSecurity(
  electronSession: Session,
  getSession: () => { baseUrl: string; token: string } | null,
  options?: {
    extraAuthOrigins?: readonly string[];
    onLocalMutationCompleted?: () => void;
    beforeLeasedMutation?: (target: PersonalSyncLeaseTarget) => Promise<void>;
  },
): void {
  const extraAuthOrigins = options?.extraAuthOrigins ?? [];
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  electronSession.setPermissionCheckHandler(() => false);

  electronSession.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = withSessionAuthorization(
        details.url,
        details.requestHeaders,
        getSession(),
        extraAuthOrigins,
      );
    const current = getSession();
    const target = classifyLocalPersonalSyncLeaseRequest(
      details.method,
      details.url,
      current?.baseUrl ?? null,
      extraAuthOrigins,
    );
    if (!target || !options?.beforeLeasedMutation) {
      callback({ requestHeaders });
      return;
    }
    void options.beforeLeasedMutation(target)
      .catch(() => undefined)
      .finally(() => callback({ requestHeaders: withSessionAuthorization(details.url, details.requestHeaders, getSession(), extraAuthOrigins) }));
  });

  electronSession.webRequest.onHeadersReceived((details, callback) => {
    const current = getSession();
    if (!current || !isExactLoopbackOrigin(details.url, current.baseUrl)) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [DESKTOP_CSP],
        "X-Content-Type-Options": ["nosniff"],
        "Referrer-Policy": ["no-referrer"],
      },
    });
  });

  electronSession.webRequest.onCompleted((details) => {
    const current = getSession();
    if (
      !current ||
      !isExactLoopbackOrigin(details.url, current.baseUrl) ||
      !["POST", "PUT", "PATCH", "DELETE"].includes(details.method) ||
      details.statusCode < 200 ||
      details.statusCode >= 400
    )
      return;
    const path = new URL(details.url).pathname;
    if (path.startsWith("/api/local/personal-sync/")) return;
    options?.onLocalMutationCompleted?.();
  });
}

export function lockWindowNavigation(
  window: BrowserWindow,
  getAllowedBaseUrl: () => string | readonly string[] | null,
  openExternal: (url: string) => Promise<void>,
): void {
  const allowedOrigins = (): string[] => {
    const raw = getAllowedBaseUrl();
    if (!raw) return [];
    if (typeof raw === "string") return [raw];
    return [...raw];
  };
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (allowedOrigins().some((origin) => isExactLoopbackOrigin(url, origin))) return;
    event.preventDefault();
    if (url.startsWith("https://")) void openExternal(url);
  });
}

/** Preserve only a renderer route while moving to a newly authenticated origin. */
export function sidecarHandoffUrl(currentUrl: string, nextBaseUrl: string): string {
  if (!isExactLoopbackOrigin(nextBaseUrl, nextBaseUrl)) {
    throw new Error("Sidecar handoff requires an exact loopback origin");
  }
  let route = "/";
  try {
    const current = new URL(currentUrl);
    if (current.protocol === "http:" && current.hostname === "127.0.0.1") {
      route = `${current.pathname}${current.search}${current.hash}`;
    }
  } catch {
    // Recovery documents and malformed URLs return to the safe root route.
  }
  return new URL(route, `${nextBaseUrl.replace(/\/$/, "")}/`).toString();
}
