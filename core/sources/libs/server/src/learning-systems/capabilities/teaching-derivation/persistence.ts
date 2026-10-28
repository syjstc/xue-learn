import type { TeachingDerivationRepository } from "../../../../../domain/src/index.js";
import {AsyncLocalStorage} from "node:async_hooks";

type TeachingDerivationGenerationFence = Readonly<{runId: string; ownerUserId: string; token: string; signal?: AbortSignal}>;
const generationFence = new AsyncLocalStorage<TeachingDerivationGenerationFence>();

/** Only background display consumers opt in. Existing section/tool callers
 * retain their API; a claimed child agent cannot write after lease takeover. */
export function runWithTeachingDerivationGenerationFence<T>(fence: TeachingDerivationGenerationFence | undefined, work: () => Promise<T>): Promise<T> {
  return fence ? generationFence.run(fence, work) : work();
}

function fencedRepository(repository: TeachingDerivationRepository, fence: TeachingDerivationGenerationFence): TeachingDerivationRepository {
  const assertOwned = async (runId: string, allowAborted = false) => {
    if (!allowAborted) fence.signal?.throwIfAborted();
    if (runId !== fence.runId) throw Error("Teaching derivation generation scope changed");
    const run = await repository.getRun(runId);
    if (!run || run.ownerUserId !== fence.ownerUserId || run.generationToken !== fence.token)
      throw Error("Teaching derivation generation lease lost");
    return run;
  };
  return new Proxy(repository, {get(target, property) {
    if (property === "getRun") return assertOwned;
    if (property === "updateRun") return async (input: Parameters<TeachingDerivationRepository["updateRun"]>[0]) => {
      await assertOwned(input.id);
      const updated = await target.updateRun({...input, expectedGenerationToken: fence.token});
      if (!updated) throw Error("Teaching derivation generation lease lost");
      return updated;
    };
    if (property === "appendStep") return async (input: Parameters<TeachingDerivationRepository["appendStep"]>[0]) => {
      await assertOwned(input.runId);
      return target.appendStep({...input, expectedGenerationToken: fence.token});
    };
    if (property === "appendEvent") return async (input: Parameters<TeachingDerivationRepository["appendEvent"]>[0]) => {
      await assertOwned(input.runId, true);
      return target.appendEvent(input);
    };
    if (property === "getStepByOrdinal") return async (runId: string, ordinal: number) => {
      await assertOwned(runId); return target.getStepByOrdinal(runId, ordinal);
    };
    if (property === "listSteps") return async (runId: string) => {
      await assertOwned(runId); return target.listSteps(runId);
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  }});
}

let configured: TeachingDerivationRepository | undefined;

export function configureTeachingDerivationPersistence(
  repository: TeachingDerivationRepository | undefined,
): void {
  configured = repository;
}

export function requireTeachingDerivationPersistence(): TeachingDerivationRepository {
  if (!configured) {
    throw new Error("Teaching-derivation persistence is not configured");
  }
  const fence = generationFence.getStore();
  return fence ? fencedRepository(configured, fence) : configured;
}
