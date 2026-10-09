import { getEnv } from "../env.js";

export function getBatchSqPreviewConcurrency(): number {
  return getEnv().BATCH_SQ_PREVIEW_CONCURRENCY;
}

export function getBatchMaterialConcurrency(): number {
  return getEnv().BATCH_MATERIAL_CONCURRENCY;
}

export function getMapExpansionConcurrency(): number {
  return getEnv().MAP_EXPANSION_CONCURRENCY;
}
