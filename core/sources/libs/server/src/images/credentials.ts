import { getEnv, type Env } from "../env.js";
import type { ActiveImageProviderId } from "./provider-ids.js";
import { hasImageProviderCredentials as checkImageCredentials } from "../providers/image/resolve.js";

export function hasImageProviderCredentials(
  provider: ActiveImageProviderId,
  env: Env = getEnv(),
): boolean {
  return checkImageCredentials(provider, env);
}
