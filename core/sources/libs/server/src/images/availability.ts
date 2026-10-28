import { getRuntimeEnvironment } from "../env.js";
import { isImageGenerationFeatureEnabled } from "../features.js";
import { hasImageProviderCredentials } from "./credentials.js";
import { isActiveImageProvider } from "./provider-ids.js";
import { getImageRuntimeConfig } from "./runtime-config.js";

export function imageGenerationUnavailableReason(): string | null {
  if (
    !isImageGenerationFeatureEnabled(getRuntimeEnvironment().XUELEARN_DESKTOP_LOCAL === "1")
  ) {
    return "Image generation is disabled for this deployment.";
  }

  const runtime = getImageRuntimeConfig();

  if (!runtime.enabled || runtime.provider === "none") {
    return "Image generation is disabled. Choose a provider in admin AI generation settings.";
  }

  if (!isActiveImageProvider(runtime.provider)) {
    return `Image provider "${runtime.provider}" is not supported. Choose another provider in admin AI generation settings.`;
  }

  if (!hasImageProviderCredentials(runtime.provider)) {
    return `Image provider "${runtime.provider}" is missing credentials. Add its API key in .env and restart the services.`;
  }

  return null;
}

export function assertImageGenerationConfigured(): void {
  const reason = imageGenerationUnavailableReason();
  if (reason) {
    throw new Error(reason);
  }
}
