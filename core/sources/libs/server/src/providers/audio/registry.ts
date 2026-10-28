import type { AudioProviderId } from "./ids.js";
import { buildProviderRegistry } from "../core/registry.js";
import { AUDIO_PROVIDER_SPECS, type AudioProviderSpec } from "./specs.js";

export const AUDIO_PROVIDER_REGISTRY = buildProviderRegistry(AUDIO_PROVIDER_SPECS);

export function getAudioProviderSpec(id: AudioProviderId): AudioProviderSpec {
  return AUDIO_PROVIDER_REGISTRY[id];
}
