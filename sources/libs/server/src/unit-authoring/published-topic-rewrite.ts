import { z } from "zod";
import { interactiveBlockSchema, type LearningMaterialContent } from "../llm/schemas.js";
import { flattenTopicToJitItems, type TopicMaterialCommit } from "../llm/material-topic.js";

/** Reading normalization migrates takeaways into prose; authoring must keep them separate. */
export function publishedMaterialForRewrite(stored: { introduction: string; blocks: string; keyTakeaways: string }): LearningMaterialContent {
  return {
    introduction: stored.introduction,
    blocks: z.array(interactiveBlockSchema).parse(JSON.parse(stored.blocks)),
    keyTakeaways: z.array(z.string()).parse(JSON.parse(stored.keyTakeaways)),
  };
}

/** Published content can be newer than the durable transcript after a failed retry. */
export function publishedTopicRewrite(
  material: LearningMaterialContent,
  request: { topicId?: string; topicIndex?: number },
) {
  const headings = material.blocks.flatMap((block, index) =>
    block.type === "heading" && block.level === 2 ? [{ block, index }] : []);
  const topicIndex = request.topicId
    ? headings.findIndex(({ block }) => block.topicId === request.topicId)
    : request.topicIndex ?? -1;
  const entry = headings[topicIndex];
  if (!entry) throw new Error("The requested topic is absent from the published section.");
  const end = headings[topicIndex + 1]?.index ?? material.blocks.length;
  const topic = { id: entry.block.topicId || `t${topicIndex + 1}`, title: entry.block.text };
  // A compact factual boundary, without image pixels, regions or old tool calls.
  const context = material.blocks.flatMap((block, index) => {
    if (block.type === "heading") return [block.text];
    if (block.type === "paragraph" && index >= entry.index && index < end) return [block.text];
    if (block.type === "callout") return [block.body];
    return [];
  }).join("\n").slice(0, 8_000);
  return {
    topic,
    prompt: `Rewrite only the published topic ${JSON.stringify(topic)}. Keep the teaching facts and scope below; this published content supersedes old examples in the transcript. Source wording and tone are not requirements: extract distinct facts, then rebuild the explanation instead of paraphrasing every sentence. Improve its display using the current contract. Other topics are preserved by the server. Use one clear main object and only necessary supporting components. Keep the existing facts, input domain, examples and limitations; remove repeated explanations, generic transitions and persona jokes that add no teaching information. State conditions directly, without sarcasm or judgments about the learner. Each cue should contribute a new fact, cause, condition or example in one or two short sentences. The first cue establishes the object, subsequent cues address stable item ids, and the last cue resolves a useful relationship instead of repeating the whole lesson. Do not author colors or animation coordinates; use the existing native components and design-token styling.\n${context}`,
    assemble(replacement: TopicMaterialCommit) {
      if (replacement.topicId !== topic.id) throw new Error("Replacement topic identity changed.");
      return [
        ...(material.introduction ? [{ kind: "introduction" as const, text: material.introduction }] : []),
        ...material.blocks.slice(0, entry.index).map(block => ({ kind: "block" as const, block })),
        ...flattenTopicToJitItems(topic, replacement),
        ...material.blocks.slice(end).map(block => ({ kind: "block" as const, block })),
        ...material.keyTakeaways.map(text => ({ kind: "takeaway" as const, text })),
      ];
    },
  };
}
