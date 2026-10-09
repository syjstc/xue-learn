import type { EntityManager } from "@mikro-orm/core";
import {
  openPersistenceOrm,
  type PersistenceConnectionInput,
  type PersistenceOrm,
} from "../orm-connection.ts";
import { assertPersistenceSchemaSafe } from "../schema-safety.ts";
import {
  createReferenceRepositories,
  REFERENCE_ENTITY_SCHEMAS,
  type ReferenceRepositories,
} from "./composition.ts";
import { installSqliteExclusiveGate } from "./sqlite-exclusive-gate.ts";

export type ReferencePersistenceRuntimeInput = Omit<
  PersistenceConnectionInput,
  "entities"
>;

export type ReferencePersistenceRuntime = Readonly<{
  orm: PersistenceOrm;
  repositories: ReferenceRepositories;
  runInTransaction<T>(
    work: (repositories: ReferenceRepositories) => Promise<T>,
  ): Promise<T>;
  close(): Promise<void>;
}>;

/**
 * Opens the personal-core reference slice at one infrastructure boundary.
 * Application services receive only the repository bundle and transaction
 * callback; the ORM manager never crosses that boundary.
 */
export async function openReferencePersistenceRuntime(
  input: ReferencePersistenceRuntimeInput & {
    /** Fresh local databases need migrations before the schema safety gate. */
    skipSchemaSafety?: boolean;
  },
): Promise<ReferencePersistenceRuntime> {
  const orm = await openPersistenceOrm({
    ...input,
    entities: REFERENCE_ENTITY_SCHEMAS,
  });
  try {
    if (!input.skipSchemaSafety) {
      await assertPersistenceSchemaSafe(orm, { kind: input.kind });
    }
    return createReferencePersistenceRuntime(orm);
  } catch (error) {
    await orm.close(true);
    throw error;
  }
}

export function createReferencePersistenceRuntime(
  orm: PersistenceOrm,
): ReferencePersistenceRuntime {
  const em = orm.em.fork();
  installSqliteExclusiveGate(em);
  return {
    orm,
    repositories: createReferenceRepositories(em),
    runInTransaction: <T>(
      work: (repositories: ReferenceRepositories) => Promise<T>,
    ) =>
      em.transactional(async (transactionalEm: EntityManager) =>
        work(createReferenceRepositories(transactionalEm)),
      ),
    close: () => orm.close(true),
  };
}
