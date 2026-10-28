import type {
  CapabilityQueryTool,
  CapabilitySettingsPort,
  DomainEvent,
  LearningSystemCapability,
  LearningSystemManifest,
  SystemCommand,
  SystemCommandResult,
  SystemViewRequest,
  TransactionContext,
} from "./types.js";
import type { CapabilityToolSet } from "../agents/core/tool-capability.js";

export type CapabilityViewResolver = NonNullable<
  LearningSystemCapability["getView"]
>;

export type LearningSystemCapabilityDefinition = {
  id: string;
  version: string;
  kind?: LearningSystemManifest["kind"];
  views?: Readonly<Record<string, CapabilityViewResolver>>;
  queryTools?: readonly CapabilityQueryTool[];
  toolSets?: readonly CapabilityToolSet[];
  settingsPorts?: readonly CapabilitySettingsPort[];
  dependencies?: LearningSystemManifest["dependencies"];
  commands?: readonly string[];
  events?: readonly string[];
  handleCommand?: (
    command: SystemCommand,
    transaction?: TransactionContext,
  ) => Promise<SystemCommandResult>;
  handleEvent?: (event: DomainEvent) => Promise<void>;
};

/**
 * Defines a capability from its owned ports. The manifest is derived from the
 * implementation so adding a view or query tool has one obvious edit point.
 */
export function defineLearningSystemCapability(
  definition: LearningSystemCapabilityDefinition,
): LearningSystemCapability {
  const views = Object.freeze({ ...(definition.views ?? {}) });
  const queryTools = Object.freeze([...(definition.queryTools ?? [])]);
  const toolSets = Object.freeze([...(definition.toolSets ?? [])]);
  const settingsPorts = Object.freeze([...(definition.settingsPorts ?? [])]);
  const viewKeys = Object.freeze(Object.keys(views));
  const manifest: LearningSystemManifest = Object.freeze({
    id: definition.id,
    version: definition.version,
    kind: definition.kind ?? "learning_system",
    ...(viewKeys.length > 0 ? { providesViews: [...viewKeys] } : {}),
    ...(queryTools.length > 0
      ? { providesQueryTools: queryTools.map((tool) => tool.key) }
      : {}),
    ...(toolSets.length > 0
      ? { providesToolSets: toolSets.map((set) => set.key) }
      : {}),
    ...(definition.commands?.length
      ? { acceptsCommands: [...definition.commands] }
      : {}),
    ...(definition.events?.length
      ? { subscribesToEvents: [...definition.events] }
      : {}),
    ...(settingsPorts.length > 0
      ? { settingsScopes: settingsPorts.map((port) => port.scope) }
      : {}),
    ...(definition.dependencies?.length
      ? { dependencies: [...definition.dependencies] }
      : {}),
  });

  return {
    manifest,
    ...(viewKeys.length > 0
      ? {
          getView(request: SystemViewRequest) {
            const resolve = views[request.key];
            return resolve ? resolve(request) : Promise.resolve(null);
          },
        }
      : {}),
    ...(queryTools.length > 0 ? { getQueryTools: () => [...queryTools] } : {}),
    ...(toolSets.length > 0 ? { getToolSets: () => [...toolSets] } : {}),
    ...(settingsPorts.length > 0
      ? { getSettingsPorts: () => [...settingsPorts] }
      : {}),
    ...(definition.handleCommand
      ? { handleCommand: definition.handleCommand }
      : {}),
    ...(definition.handleEvent ? { handleEvent: definition.handleEvent } : {}),
  };
}
