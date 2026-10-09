import type { Env } from "../../env.js";

/** Generation backends — each modality can pick a different vendor/model. */
export type GenerationModality = "llm" | "image" | "audio";

/**
 * Per-run provider picks from a router agent. Omitted modalities fall back to
 * user/env runtime config via `getLlmProvider()` / `getImageProvider()` / `getAudioProvider()`.
 */
export type GenerationProviderContext = Partial<
  Record<GenerationModality, ProviderSelection<string, Record<string, unknown>> | null>
>;

/**
 * Explicit provider pick from settings, env defaults, or a future router agent.
 * Pass `undefined` to use the effective runtime config for that modality.
 */
export type ProviderSelection<
  TId extends string,
  TOptions = Record<string, never>,
> = {
  id: TId;
  model?: string;
  options?: TOptions;
};

export type ProviderFactoryContext = {
  env: Env;
};

/**
 * Bundles vendor metadata, credential checks, default options, and factory.
 * Add a new vendor by defining one spec and registering it in the modality registry.
 */
export type ProviderSpec<
  TId extends string,
  TInstance,
  TOptions = Record<string, never>,
> = {
  id: TId;
  label: string;
  description?: string;
  /** Known models for UI / validation. Empty when model is not applicable. */
  models: string[];
  defaultModel: (env: Env) => string;
  hasCredentials: (env: Env) => boolean;
  defaultOptions: (env: Env) => TOptions;
  create: (
    ctx: ProviderFactoryContext,
    selection: ProviderSelection<TId, TOptions>,
  ) => TInstance;
};
