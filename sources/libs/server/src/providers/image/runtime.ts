import type { ImageRuntimeConfig } from "../../images/runtime-config.js";
import { isActiveImageProvider } from "./ids.js";
import type { ImageProviderSelection } from "./types.js";

export function imageRuntimeConfigToSelection(
  config: ImageRuntimeConfig,
): ImageProviderSelection | null {
  if (!config.enabled || config.provider === "none") {
    return null;
  }
  if (!isActiveImageProvider(config.provider)) {
    return null;
  }
  return {
    id: config.provider,
    model: config.model,
  };
}
