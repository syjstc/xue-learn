import type { LearningSystemCapability } from "./types.js";
import type { CreateBuiltinReadCapabilitiesOptions } from "./capabilities/support/builtin.js";
export type HostLearningCapabilityFactory = (options: CreateBuiltinReadCapabilitiesOptions) => readonly LearningSystemCapability[];
const factories = new Map<string, HostLearningCapabilityFactory>();
export function registerHostLearningCapabilities(ownerId: string, factory: HostLearningCapabilityFactory): void {
 const prior = factories.get(ownerId);
 if (prior && prior !== factory) throw new Error(`Host capability owner ${ownerId} is already registered`);
 factories.set(ownerId, factory);
}
export function createHostLearningCapabilities(options: CreateBuiltinReadCapabilitiesOptions): LearningSystemCapability[] { return [...factories.values()].flatMap(factory => [...factory(options)]); }
