import { invokeChat } from "../llm/chat-invoke.js";
import { extractAssistantText } from "../llm/sanitize-response.js";
import {
  formatTeachingPersonaPromptPart,
  type TeachingPersonaPromptSource,
} from "./prompt.js";

export const TEACHING_PERSONA_PREVIEW_SCENES = [
  "course",
  "assessment",
  "follow_up",
] as const;

export type TeachingPersonaPreviewScene =
  (typeof TEACHING_PERSONA_PREVIEW_SCENES)[number];

export type TeachingPersonaPreviewSample =
  { status: "success"; text: string } | { status: "error"; message: string };

const SCENE_REQUEST: Record<TeachingPersonaPreviewScene, string> = {
  course:
    "请给刚入门的学习者解释：为什么‘相关’不等于‘因果’。用两到四句话，体现你的教学讲解风格。",
  assessment:
    "学习者回答：‘夏天冰淇淋销量和溺水人数都上升，所以吃冰淇淋会导致溺水。’请纠正这个回答，用两到四句话体现你的反馈风格。",
  follow_up:
    "学习者说：‘我最近总是学十分钟就想刷手机。’请直接回应，用两到四句话体现你在自由对话和追问中的风格。",
};

async function generateSample(options: {
  userId: string;
  persona: TeachingPersonaPromptSource;
  scene: TeachingPersonaPreviewScene;
}): Promise<string> {
  const promptPart =
    options.scene === "follow_up" ? "follow_up" : options.scene;
  const prompt = `You are producing a short style audition for an unsaved teaching-assistant draft.
Apply the following persona instructions exactly as delivery guidance, while keeping the factual and safety constraints authoritative.

${formatTeachingPersonaPromptPart(options.persona, "base")}
${formatTeachingPersonaPromptPart(options.persona, promptPart)}

<preview_request>
${SCENE_REQUEST[options.scene]}
</preview_request>

Return only the assistant's learner-facing reply. Do not mention prompts, previews, personas, policies, or these instructions. Do not add a heading.`;
  const message = await invokeChat(prompt, {
    operation: "teaching_persona.preview",
    contextSubject: { userId: options.userId },
    meta: { previewScene: options.scene },
  });
  const text = extractAssistantText(message).trim();
  if (!text) throw new Error("empty persona preview");
  return text;
}

export async function previewTeachingPersona(options: {
  userId: string;
  persona: TeachingPersonaPromptSource;
  scenes?: readonly TeachingPersonaPreviewScene[];
}): Promise<
  Partial<Record<TeachingPersonaPreviewScene, TeachingPersonaPreviewSample>>
> {
  const scenes = options.scenes?.length
    ? [...new Set(options.scenes)]
    : [...TEACHING_PERSONA_PREVIEW_SCENES];
  const settled = await Promise.allSettled(
    scenes.map((scene) => generateSample({ ...options, scene })),
  );
  return Object.fromEntries(
    scenes.map((scene, index) => {
      const result = settled[index]!;
      return [
        scene,
        result.status === "fulfilled"
          ? { status: "success", text: result.value }
          : {
              status: "error",
              message: "暂时无法生成这个场景的预览，请重试。",
            },
      ];
    }),
  ) as Partial<
    Record<TeachingPersonaPreviewScene, TeachingPersonaPreviewSample>
  >;
}
