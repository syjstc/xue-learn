import { LLM_PROVIDER_SPECS } from "./specs.js";
export type AvailableLlmModel = Readonly<{ provider: string; model: string }>;
export type LlmModelAvailabilityPort = () => Promise<readonly AvailableLlmModel[]>;
let availability: LlmModelAvailabilityPort | null = null;
/** Hosts may restrict available models independently of learning rules and accounting. */
export function configureLlmModelAvailability(value: LlmModelAvailabilityPort | null): void { availability = value; }
export async function listAvailableLlmModels(): Promise<readonly AvailableLlmModel[]> {
 return availability ? availability() : LLM_PROVIDER_SPECS.flatMap(spec => spec.models.map(model => ({provider: spec.id, model})));
}
