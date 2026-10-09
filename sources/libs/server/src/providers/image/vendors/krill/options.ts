/** Krill 视觉创作 channel (`gpt-image-*`) via OpenAI Images API. */
export const KRILL_IMAGE_MODELS = ["gpt-image-2"] as const;

export const DEFAULT_KRILL_IMAGE_MODEL = KRILL_IMAGE_MODELS[0];

/** Krill 海外 Images API root. Visual creation must not use 国内极速 SLB. */
export const KRILL_IMAGE_OVERSEAS_BASE_URL = "https://api.krill-code.net/v1";

/** Krill 三网 CDN Images API root. Used when 海外 returns a gateway 5xx. */
export const KRILL_IMAGE_CDN_BASE_URL = "https://api.cdn-krill-ai.com/v1";

export const DEFAULT_KRILL_IMAGE_BASE_URL = KRILL_IMAGE_OVERSEAS_BASE_URL;

export function krillImageBaseUrls(preferred?: string): string[] {
  const first = (preferred ?? DEFAULT_KRILL_IMAGE_BASE_URL).replace(/\/$/, "");
  const extras = [
    KRILL_IMAGE_OVERSEAS_BASE_URL.replace(/\/$/, ""),
    KRILL_IMAGE_CDN_BASE_URL.replace(/\/$/, ""),
  ];
  return [first, ...extras.filter((url) => url !== first)];
}

/**
 * Krill's `/v1/images/generations` router only lists `gpt-image-2`.
 * Catalog SKUs like `gpt-image-2-2k` 404 with "no route available".
 */
export function krillRoutedImageModel(model: string | undefined): string {
  const id = model?.trim() || DEFAULT_KRILL_IMAGE_MODEL;
  if (/^gpt-image-2([._-]?2k)?$/i.test(id)) return DEFAULT_KRILL_IMAGE_MODEL;
  return id;
}
