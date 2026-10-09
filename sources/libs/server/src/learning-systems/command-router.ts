import { LearningSystemRegistry } from "./registry.js";
import type {
  SystemCommand,
  SystemCommandResult,
  TransactionContext,
} from "./types.js";

export class SystemCommandRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SystemCommandRoutingError";
  }
}

/**
 * Routes typed intent to the single registered owner. The router never derives
 * capability state and deliberately exposes no untyped repository access.
 */
export class SystemCommandRouter {
  constructor(private readonly registry: LearningSystemRegistry) {}

  async execute(
    command: SystemCommand,
    transaction?: TransactionContext,
  ): Promise<SystemCommandResult> {
    const handler = this.registry.getCommandHandler(command.type);
    if (!handler?.handleCommand) {
      throw new SystemCommandRoutingError(
        `No learning system owns command "${command.type}"`,
      );
    }
    if (!command.subject.userId && !command.subject.goalId) {
      throw new SystemCommandRoutingError(
        `Command "${command.type}" requires a user or goal subject`,
      );
    }
    const result = await handler.handleCommand(
      {
        ...command,
        subject: { ...command.subject },
      },
      transaction,
    );
    if (result.handledBy !== handler.manifest.id) {
      throw new SystemCommandRoutingError(
        `Command "${command.type}" returned owner "${result.handledBy}" instead of "${handler.manifest.id}"`,
      );
    }
    return result;
  }
}
