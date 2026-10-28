import { AsyncLocalStorage } from "node:async_hooks";
import type { EntityManager } from "@mikro-orm/core";

function isSqlite(em: EntityManager): boolean {
  return em
    .getConnection()
    .getPlatform()
    .constructor.name.toLocaleLowerCase()
    .includes("sqlite");
}

/**
 * Desktop-local uses one SQLite connection for HTTP and the in-process outbox
 * worker. Concurrent `em.transactional` / `connection.execute` on that handle
 * (for example Retry wrapping BEGIN while `claimDue` already holds BEGIN)
 * never returns, so every local API appears hung.
 *
 * Hold an exclusive async gate across each transaction and each autocommit
 * statement on the reference EntityManager.
 */
export function installSqliteExclusiveGate(em: EntityManager): void {
  if (!isSqlite(em)) return;

  let chain = Promise.resolve();
  const owner = Symbol("sqlite-exclusive-gate-owner");
  const ownership = new AsyncLocalStorage<symbol>();
  const exclusive = <T>(work: () => Promise<T> | T): Promise<T> => {
    // Calls made by the transaction currently holding the gate must be able to
    // reach the connection. A process-global depth counter cannot distinguish
    // those calls from an unrelated HTTP request or outbox poll that happens
    // to start while the transaction is open.
    if (ownership.getStore() === owner) return Promise.resolve().then(work);

    const runWork = () => ownership.run(owner, work);
    const run = chain.then(runWork, runWork);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };

  const originalTransactional = em.transactional.bind(em);
  em.transactional = ((work, ...rest) =>
    exclusive(() =>
      originalTransactional(work, ...rest),
    )) as EntityManager["transactional"];

  const connection = em.getConnection();
  const originalExecute = connection.execute.bind(connection);
  connection.execute = ((...args: Parameters<typeof originalExecute>) =>
    exclusive(() => originalExecute(...args))) as typeof connection.execute;
}
