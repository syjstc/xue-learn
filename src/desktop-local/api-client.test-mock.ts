export const PRODUCTION_API_BASE_URL = "https://api.xue-learn.com";

export function getApiBaseUrl(): string {
  return "";
}

export function apiUrl(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

export async function apiFetch(): Promise<Response> {
  throw new Error("apiFetch is unavailable in route-component tests");
}
