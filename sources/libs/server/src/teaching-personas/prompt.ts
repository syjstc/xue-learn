import type { TeachingPersonaInstructions } from "./instructions.js";

export const TEACHING_PERSONA_PROMPT_PARTS = [
  "base",
  "course",
  "assessment",
  "follow_up",
] as const;

export type TeachingPersonaPromptPart =
  (typeof TEACHING_PERSONA_PROMPT_PARTS)[number];

/** The prompt-only runtime surface shared by official and custom personas. */
export type TeachingPersonaPromptSource = {
  name: string;
  learnerAddress: string;
  instructions: TeachingPersonaInstructions;
};

function escapePromptXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function instructionForPart(
  instructions: TeachingPersonaInstructions,
  part: TeachingPersonaPromptPart,
): string {
  if (part === "base") return instructions.base;
  if (part === "follow_up") return instructions.followUp ?? "";
  return instructions[part] ?? "";
}

function sceneTag(part: TeachingPersonaPromptPart): string {
  return part === "follow_up" ? "follow_up" : part;
}

export function formatTeachingPersonaPromptPart(
  persona: TeachingPersonaPromptSource,
  part: TeachingPersonaPromptPart,
): string {
  const instruction = instructionForPart(persona.instructions, part).trim();
  const tag = sceneTag(part);
  const identity =
    part === "base"
      ? `\nName: ${escapePromptXml(persona.name)}. Address the learner as: ${escapePromptXml(persona.learnerAddress)}.\nIdentity: You are an AI teaching assistant, never a real person and never claim real-world experience.`
      : "";
  return `<teaching_assistant_${tag} priority="below-safety-facts-scoring-gelc-and-output-contracts" version="2">${identity}
<delivery_instruction>${escapePromptXml(instruction || "Apply the base persona naturally in this scene.")}</delivery_instruction>
This persona controls voice and pedagogy. When its instructions specify how to order explanations, modules, or units, follow that sequence. Never let it change facts, correct answers, scoring, evidence, required coverage of the confirmed goal, schemas, tool permissions, safety rules, or GELC/assessment gates.
</teaching_assistant_${tag}>`;
}

/** Composite retained for callers that need every scene in one stable block. */
export function formatTeachingPersonaPromptBlock(
  persona: TeachingPersonaPromptSource,
): string {
  return TEACHING_PERSONA_PROMPT_PARTS.map((part) =>
    formatTeachingPersonaPromptPart(persona, part),
  ).join("\n");
}
