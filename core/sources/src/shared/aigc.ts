export const AIGC_IMAGE_CACHE_VERSION = "v1";

export function withAigcImageVersion(url: string): string {
  if (!url || /[?&]aigc=/.test(url)) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}aigc=${AIGC_IMAGE_CACHE_VERSION}`;
}
