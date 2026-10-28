import { AsyncLocalStorage } from "node:async_hooks";
import { presentationCapabilitiesSchema, type PresentationCapabilities } from "../../../domain/src/presentation-capabilities.js";
export { presentationDisplayIssues } from "../../../domain/src/presentation-capabilities.js";
const context = new AsyncLocalStorage<{capabilities?: PresentationCapabilities}>();
export function runWithPresentationCapabilities<T>(capabilities: PresentationCapabilities | undefined, run: () => T): T {
  return context.run({capabilities: capabilities ? presentationCapabilitiesSchema.parse(capabilities) : undefined}, run);
}
export function getActivePresentationCapabilities(): PresentationCapabilities | undefined { return context.getStore()?.capabilities; }
export function supportsDisplay(type: string, capabilities = getActivePresentationCapabilities()): boolean {
  return !capabilities || capabilities.supportedDisplayTypes.includes(type);
}
export function presentationCapabilityInstruction(imagesEnabled: boolean, capabilities = getActivePresentationCapabilities()): string {
  if (!capabilities) return "";
  const supported = capabilities.supportedDisplayTypes.filter(type => imagesEnabled || !["illustration", "guided_image_intent"].includes(type));
  return `Presentation capability facts for this request (apply to new displays):\n- Supported display types: ${supported.join(", ")}. Choose only supported displays while preserving all source facts, proofs and spoken cues.\n- A stage supports at most ${capabilities.maxStageFigures} figures with layouts ${capabilities.allowedStageLayouts.join(", ") || "none"}.\n${capabilities.stageRoles ? `- A stage has exactly two figures: first ${capabilities.stageRoles.mainTypes.join(" or ")}, then ${capabilities.stageRoles.helperTypes.join(" or ")}. Keep other teaching boards in ordered topics and conversation standalone.\n` : ""}- Keep every narration target bound to an actual display or figure. Put extended explanation in complete cues rather than squeezing more boards into one stage. Never truncate accepted content to satisfy a display restriction.${imagesEnabled ? "" : "\n- Image generation is unavailable. Do not emit illustration or guided_image_intent displays."}`;
}
