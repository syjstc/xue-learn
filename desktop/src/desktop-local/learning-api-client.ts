import { getCurrentUiLocale, translateCurrent } from "@xue-learn/core/i18n";
import { isDesktopLocalRuntime } from "@xue-learn/core/client-runtime";
/** The existing desktop request branch, separated from hosted refresh/billing.
 * Electron's trusted session layer supplies the workspace authorization token. */
export function getApiBaseUrl(): string {
  return "";
}
export function apiUrl(path: string): string {
  return path.startsWith("/") ? path : "/" + path;
}
export async function apiFetch(
  path: string,
  init?: RequestInit,
): Promise<Response> {
  if (!isDesktopLocalRuntime())
    throw new Error(
      "A desktop learning workspace must be connected before making a local request",
    );
  const headers = new Headers();
  headers.set("Accept-Language", getCurrentUiLocale());
  if (!(init?.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  try {
    return await fetch(apiUrl(path), {
      ...init,
      cache: "no-store",
      credentials: "omit",
      headers,
    });
  } catch (error) {
    const failure = new Error(translateCurrent("errors.network"));
    if (error instanceof Error)
      (failure as Error & { cause?: unknown }).cause = error;
    throw failure;
  }
}
