/** All selectable image providers (including disabled). */
export const imageProviderIds = [
  "none",
  "minimax",
  "apimart",
  "doubao",
  "krill",
] as const;
export type ImageProviderId = (typeof imageProviderIds)[number];

/** Providers that can generate images (excludes "none"). */
export const activeImageProviderIds = [
  "minimax",
  "apimart",
  "doubao",
  "krill",
] as const;
export type ActiveImageProviderId = (typeof activeImageProviderIds)[number];

export function isActiveImageProvider(
  id: ImageProviderId,
): id is ActiveImageProviderId {
  return id !== "none";
}
