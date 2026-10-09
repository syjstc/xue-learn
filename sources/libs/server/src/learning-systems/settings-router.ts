import { LearningSystemRegistry } from "./registry.js";
import type { SettingsScope, SettingsSubject } from "./types.js";

export class CapabilitySettingsRoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilitySettingsRoutingError";
  }
}

export class CapabilitySettingsRouter {
  constructor(private readonly registry: LearningSystemRegistry) {}

  async read(
    capabilityId: string,
    scope: SettingsScope,
    subject: SettingsSubject,
  ): Promise<unknown> {
    const port = this.registry.getSettingsPort(capabilityId, scope);
    if (!port) {
      throw new CapabilitySettingsRoutingError(
        `No "${scope}" settings port is registered for "${capabilityId}"`,
      );
    }
    this.assertSubject(scope, subject);
    return port.read({ ...subject });
  }

  async patch(
    capabilityId: string,
    scope: SettingsScope,
    subject: SettingsSubject,
    input: unknown,
  ): Promise<unknown> {
    const port = this.registry.getSettingsPort(capabilityId, scope);
    if (!port) {
      throw new CapabilitySettingsRoutingError(
        `No "${scope}" settings port is registered for "${capabilityId}"`,
      );
    }
    this.assertSubject(scope, subject);
    const parsed = port.validatePatch(input);
    return port.patch({ ...subject }, parsed);
  }

  private assertSubject(scope: SettingsScope, subject: SettingsSubject): void {
    if (scope === "user" && !subject.userId) {
      throw new CapabilitySettingsRoutingError(
        "User settings require a user subject",
      );
    }
    if (scope === "goal" && (!subject.userId || !subject.goalId)) {
      throw new CapabilitySettingsRoutingError(
        "Goal settings require user and goal subjects",
      );
    }
    if (scope === "global" && !subject.adminUserId) {
      throw new CapabilitySettingsRoutingError(
        "Global settings require an administrator subject",
      );
    }
  }
}
