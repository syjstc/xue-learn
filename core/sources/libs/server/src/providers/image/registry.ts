import type { ActiveImageProviderId } from "./ids.js";
import { buildProviderRegistry } from "../core/registry.js";
import { IMAGE_PROVIDER_SPECS, type ImageProviderSpec } from "./specs.js";

export const IMAGE_PROVIDER_REGISTRY = buildProviderRegistry(IMAGE_PROVIDER_SPECS);

export function getImageProviderSpec(id: ActiveImageProviderId): ImageProviderSpec {
  return IMAGE_PROVIDER_REGISTRY[id];
}
