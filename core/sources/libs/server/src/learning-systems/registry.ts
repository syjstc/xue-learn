import type {
  CapabilityQueryTool,
  CapabilitySettingsPort,
  LearningSystemCapability,
  LearningSystemManifest,
  SettingsScope,
} from "./types.js";
import type { CapabilityToolSet } from "../agents/core/tool-capability.js";

type ParsedVersion = readonly [major: number, minor: number, patch: number];

function parseVersion(version: string, label: string): ParsedVersion {
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(version);
  if (!match) {
    throw new Error(
      `${label} must be a semantic version, received "${version}"`,
    );
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function meetsMinimumVersion(actual: string, minimum: string): boolean {
  const actualParts = parseVersion(actual, "Capability version");
  const minimumParts = parseVersion(minimum, "Minimum capability version");
  for (let index = 0; index < actualParts.length; index += 1) {
    if (actualParts[index] > minimumParts[index]) return true;
    if (actualParts[index] < minimumParts[index]) return false;
  }
  return true;
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.trim()) {
      throw new Error(`${label} cannot contain an empty value`);
    }
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label} "${value}" in capability manifest`);
    }
    seen.add(value);
  }
}

function settingsKey(capabilityId: string, scope: SettingsScope): string {
  return `${capabilityId}:${scope}`;
}

/**
 * Trusted, process-local registry for statically compiled learning systems.
 * Runtime consumers should use brokers/routers rather than treating this as a
 * general service locator.
 */
export class LearningSystemRegistry {
  private readonly capabilities = new Map<string, LearningSystemCapability>();
  private readonly viewOwners = new Map<string, LearningSystemCapability>();
  private readonly queryTools = new Map<string, CapabilityQueryTool>();
  private readonly toolSets = new Map<string, CapabilityToolSet>();
  private readonly commandOwners = new Map<string, LearningSystemCapability>();
  private readonly settingsPorts = new Map<string, CapabilitySettingsPort>();
  private toolCapabilityId: string | undefined;
  private sealed = false;

  register(capability: LearningSystemCapability): this {
    if (this.sealed) {
      throw new Error("Learning system registry is sealed");
    }

    const { manifest } = capability;
    this.validateManifest(manifest);
    if (this.capabilities.has(manifest.id)) {
      throw new Error(`Duplicate capability id "${manifest.id}"`);
    }
    if (manifest.kind === "tool_capability") {
      if (this.toolCapabilityId) {
        throw new Error(
          `Tool Capability is already registered as "${this.toolCapabilityId}"`,
        );
      }
      this.toolCapabilityId = manifest.id;
    }

    const tools = capability.getQueryTools?.() ?? [];
    const toolSets = capability.getToolSets?.() ?? [];
    const ports = capability.getSettingsPorts?.() ?? [];
    this.validateDeclaredImplementations(capability, tools, toolSets, ports);
    this.assertOwnershipAvailable(manifest, tools, toolSets, ports);

    this.capabilities.set(manifest.id, capability);
    for (const key of manifest.providesViews ?? []) {
      this.viewOwners.set(key, capability);
    }
    for (const tool of tools) {
      this.queryTools.set(tool.key, tool);
    }
    for (const set of toolSets) {
      this.toolSets.set(set.key, set);
    }
    for (const command of manifest.acceptsCommands ?? []) {
      this.commandOwners.set(command, capability);
    }
    for (const port of ports) {
      this.settingsPorts.set(settingsKey(port.capabilityId, port.scope), port);
    }
    return this;
  }

  seal(): this {
    if (this.sealed) return this;
    this.validateDependencies();
    this.validateDependencyCycles();
    this.sealed = true;
    return this;
  }

  isSealed(): boolean {
    return this.sealed;
  }

  getCapability(capabilityId: string): LearningSystemCapability | undefined {
    return this.capabilities.get(capabilityId);
  }

  getCapabilities(): readonly LearningSystemCapability[] {
    return Object.freeze([...this.capabilities.values()]);
  }

  getViewProvider(key: string): LearningSystemCapability | undefined {
    return this.viewOwners.get(key);
  }

  getQueryTool(key: string): CapabilityQueryTool | undefined {
    return this.queryTools.get(key);
  }

  getToolSet(key: string): CapabilityToolSet | undefined {
    return this.toolSets.get(key);
  }

  getToolSets(): readonly CapabilityToolSet[] {
    return Object.freeze([...this.toolSets.values()]);
  }

  getCommandHandler(type: string): LearningSystemCapability | undefined {
    return this.commandOwners.get(type);
  }

  getSettingsPort(
    capabilityId: string,
    scope: SettingsScope,
  ): CapabilitySettingsPort | undefined {
    return this.settingsPorts.get(settingsKey(capabilityId, scope));
  }

  private validateManifest(manifest: LearningSystemManifest): void {
    if (!manifest.id.trim()) {
      throw new Error("Capability id cannot be empty");
    }
    parseVersion(manifest.version, `Version for capability "${manifest.id}"`);
    assertUnique(manifest.providesViews ?? [], "view key");
    assertUnique(manifest.providesQueryTools ?? [], "query tool key");
    assertUnique(manifest.providesToolSets ?? [], "tool set key");
    assertUnique(manifest.acceptsCommands ?? [], "command type");
    assertUnique(manifest.subscribesToEvents ?? [], "event subscription");
    assertUnique(manifest.settingsScopes ?? [], "settings scope");
    assertUnique(
      (manifest.dependencies ?? []).map(
        (dependency) => dependency.capabilityId,
      ),
      "dependency",
    );
    for (const dependency of manifest.dependencies ?? []) {
      if (dependency.capabilityId === manifest.id) {
        throw new Error(`Capability "${manifest.id}" cannot depend on itself`);
      }
      if (dependency.minimumVersion) {
        parseVersion(
          dependency.minimumVersion,
          `Minimum version for dependency "${dependency.capabilityId}"`,
        );
      }
    }
  }

  private validateDeclaredImplementations(
    capability: LearningSystemCapability,
    tools: CapabilityQueryTool[],
    toolSets: CapabilityToolSet[],
    ports: CapabilitySettingsPort[],
  ): void {
    const { manifest } = capability;
    const declaredTools = new Set(manifest.providesQueryTools ?? []);
    const implementedTools = new Set(tools.map((tool) => tool.key));
    const declaredToolSets = new Set(manifest.providesToolSets ?? []);
    const implementedToolSets = new Set(toolSets.map((set) => set.key));

    for (const tool of tools) {
      if (tool.ownerCapabilityId !== manifest.id) {
        throw new Error(
          `Query tool "${tool.key}" declares owner "${tool.ownerCapabilityId}" instead of "${manifest.id}"`,
        );
      }
      if (!declaredTools.has(tool.key)) {
        throw new Error(
          `Capability "${manifest.id}" implements undeclared query tool "${tool.key}"`,
        );
      }
      if (!Number.isSafeInteger(tool.schemaVersion) || tool.schemaVersion < 1) {
        throw new Error(
          `Query tool "${tool.key}" has an invalid schema version`,
        );
      }
      if (!tool.description.trim()) {
        throw new Error(`Query tool "${tool.key}" has no description`);
      }
      if (!Number.isFinite(tool.maxResultTokens) || tool.maxResultTokens <= 0) {
        throw new Error(
          `Query tool "${tool.key}" has an invalid result token limit`,
        );
      }
      assertUnique(tool.requiredScopes, `required scope for "${tool.key}"`);
    }
    for (const key of declaredTools) {
      if (!implementedTools.has(key)) {
        throw new Error(
          `Capability "${manifest.id}" does not implement declared query tool "${key}"`,
        );
      }
    }
    for (const set of toolSets) {
      if (set.ownerCapabilityId !== manifest.id) {
        throw new Error(
          `Tool set "${set.key}" declares owner "${set.ownerCapabilityId}" instead of "${manifest.id}"`,
        );
      }
      if (!declaredToolSets.has(set.key)) {
        throw new Error(
          `Capability "${manifest.id}" implements undeclared tool set "${set.key}"`,
        );
      }
      parseVersion(set.version, `Version for tool set "${set.key}"`);
      if (!set.description.trim()) {
        throw new Error(`Tool set "${set.key}" has no description`);
      }
      assertUnique(
        set.tools.map((tool) => tool.name),
        `tool name for set "${set.key}"`,
      );
    }
    for (const key of declaredToolSets) {
      if (!implementedToolSets.has(key)) {
        throw new Error(
          `Capability "${manifest.id}" does not implement declared tool set "${key}"`,
        );
      }
    }

    const declaredScopes = new Set(manifest.settingsScopes ?? []);
    const implementedScopes = new Set<SettingsScope>();
    for (const port of ports) {
      if (port.capabilityId !== manifest.id) {
        throw new Error(
          `Settings port for "${port.scope}" declares owner "${port.capabilityId}" instead of "${manifest.id}"`,
        );
      }
      if (!declaredScopes.has(port.scope)) {
        throw new Error(
          `Capability "${manifest.id}" implements undeclared settings scope "${port.scope}"`,
        );
      }
      if (implementedScopes.has(port.scope)) {
        throw new Error(
          `Duplicate settings ownership "${settingsKey(manifest.id, port.scope)}"`,
        );
      }
      implementedScopes.add(port.scope);
    }
    for (const scope of declaredScopes) {
      if (!implementedScopes.has(scope)) {
        throw new Error(
          `Capability "${manifest.id}" does not implement declared settings scope "${scope}"`,
        );
      }
    }

    if ((manifest.providesViews?.length ?? 0) > 0 && !capability.getView) {
      throw new Error(
        `Capability "${manifest.id}" declares views but has no getView implementation`,
      );
    }
    if (
      (manifest.acceptsCommands?.length ?? 0) > 0 &&
      !capability.handleCommand
    ) {
      throw new Error(
        `Capability "${manifest.id}" declares commands but has no handleCommand implementation`,
      );
    }
    if (
      (manifest.subscribesToEvents?.length ?? 0) > 0 &&
      !capability.handleEvent
    ) {
      throw new Error(
        `Capability "${manifest.id}" subscribes to events but has no handleEvent implementation`,
      );
    }
  }

  private assertOwnershipAvailable(
    manifest: LearningSystemManifest,
    tools: CapabilityQueryTool[],
    toolSets: CapabilityToolSet[],
    ports: CapabilitySettingsPort[],
  ): void {
    for (const key of manifest.providesViews ?? []) {
      const existing = this.viewOwners.get(key);
      if (existing) {
        throw new Error(
          `Duplicate view ownership "${key}" by "${existing.manifest.id}" and "${manifest.id}"`,
        );
      }
    }
    for (const tool of tools) {
      const existing = this.queryTools.get(tool.key);
      if (existing) {
        throw new Error(
          `Duplicate query tool ownership "${tool.key}" by "${existing.ownerCapabilityId}" and "${manifest.id}"`,
        );
      }
    }
    for (const set of toolSets) {
      if (this.toolSets.has(set.key)) {
        throw new Error(`Duplicate tool set owner for "${set.key}"`);
      }
    }
    for (const command of manifest.acceptsCommands ?? []) {
      const existing = this.commandOwners.get(command);
      if (existing) {
        throw new Error(
          `Duplicate command ownership "${command}" by "${existing.manifest.id}" and "${manifest.id}"`,
        );
      }
    }
    for (const port of ports) {
      const key = settingsKey(port.capabilityId, port.scope);
      if (this.settingsPorts.has(key)) {
        throw new Error(`Duplicate settings ownership "${key}"`);
      }
    }
  }

  private validateDependencies(): void {
    for (const capability of this.capabilities.values()) {
      for (const dependency of capability.manifest.dependencies ?? []) {
        const target = this.capabilities.get(dependency.capabilityId);
        if (!target) {
          if (dependency.optional) continue;
          throw new Error(
            `Capability "${capability.manifest.id}" requires missing capability "${dependency.capabilityId}"`,
          );
        }
        if (
          dependency.minimumVersion &&
          !meetsMinimumVersion(
            target.manifest.version,
            dependency.minimumVersion,
          )
        ) {
          throw new Error(
            `Capability "${capability.manifest.id}" requires "${dependency.capabilityId}" >= ${dependency.minimumVersion}, found ${target.manifest.version}`,
          );
        }
      }
    }
  }

  private validateDependencyCycles(): void {
    const visiting = new Set<string>();
    const visited = new Set<string>();

    const visit = (capabilityId: string, path: string[]): void => {
      if (visiting.has(capabilityId)) {
        const cycleStart = path.indexOf(capabilityId);
        const cycle = [...path.slice(cycleStart), capabilityId].join(" -> ");
        throw new Error(`Learning system dependency cycle: ${cycle}`);
      }
      if (visited.has(capabilityId)) return;

      visiting.add(capabilityId);
      const capability = this.capabilities.get(capabilityId);
      for (const dependency of capability?.manifest.dependencies ?? []) {
        if (this.capabilities.has(dependency.capabilityId)) {
          visit(dependency.capabilityId, [...path, capabilityId]);
        }
      }
      visiting.delete(capabilityId);
      visited.add(capabilityId);
    };

    for (const capabilityId of this.capabilities.keys()) {
      visit(capabilityId, []);
    }
  }
}
