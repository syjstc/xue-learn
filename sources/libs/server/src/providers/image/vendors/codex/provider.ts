import type { Env } from "../../../../env.js";
import {
  CODEX_BACKEND_BASE_URL,
  CodexBackendError,
  codexFetch,
} from "../../../llm/vendors/codex/runtime.js";
import type {
  GenerateImageInput,
  GenerateImageResult,
  ImageProvider,
} from "../../types.js";
import { wrapImageGenerationPrompt } from "../../../../images/prompt-language.js";
import {
  CODEX_IMAGE_RESPONSES_MODEL,
  DEFAULT_CODEX_IMAGE_MODEL,
} from "./options.js";

const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_RESPONSE_EVENTS = 512;
const MAX_IMAGE_BASE64_CHARS = 64 * 1024 * 1024;
// Image generation/editing may stay silent for several minutes before returning
// pixels. Allow slow renders to finish; the caller can still cancel at any time.
const CODEX_IMAGE_TIMEOUT_MS = 15 * 60_000;

type CodexImageItem = {
  type?: string;
  result?: string | null;
  status?: "in_progress" | "completed" | "generating" | "failed";
  revised_prompt?: string;
};

type CodexImageEvent = {
  type?: string;
  item?: CodexImageItem;
  response?: {
    error?: { message?: string; code?: string };
    incomplete_details?: { reason?: string };
    output?: CodexImageItem[];
  };
  error?: { message?: string; code?: string };
  message?: string;
};

function imageSize(input: GenerateImageInput, model: string): string {
  const ratio = input.aspectRatio ?? "1:1";
  const compact = input.compact === true || input.resolution === "1k";
  const large = input.resolution === "2k";

  if (model !== "gpt-image-2") {
    if (ratio === "1:1") return "1024x1024";
    return ["2:3", "3:4", "9:16"].includes(ratio) ? "1024x1536" : "1536x1024";
  }

  if (compact) {
    switch (ratio) {
      case "1:1":
        return "1024x1024";
      case "2:3":
      case "3:4":
      case "9:16":
        return "1024x1536";
      default:
        return "1536x1024";
    }
  }

  if (large) {
    switch (ratio) {
      case "1:1":
        return "2048x2048";
      case "2:3":
      case "3:4":
      case "9:16":
        return "2160x3840";
      case "16:9":
        return "2048x1152";
      default:
        return "2048x1152";
    }
  }

  switch (ratio) {
    case "1:1":
      return "2048x2048";
    case "2:3":
    case "3:4":
    case "9:16":
      return "2160x3840";
    case "16:9":
      return "3840x2160";
    default:
      return "2048x1152";
  }
}

async function readResponseBody(response: Response): Promise<string> {
  const body = await response.text();
  if (Buffer.byteLength(body, "utf8") > MAX_RESPONSE_BYTES) {
    throw new Error("Codex image generation response exceeded the size limit");
  }
  return body;
}

function parseEvents(body: string): CodexImageEvent[] {
  const events: CodexImageEvent[] = [];
  for (const frame of body.replace(/\r\n?/g, "\n").split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n")
      .trim();
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data) as CodexImageEvent);
    } catch {
      // Ignore a non-JSON intermediary frame; terminal provider errors remain
      // visible through the HTTP status or a parsed error event.
    }
    if (events.length > MAX_RESPONSE_EVENTS) {
      throw new Error(
        "Codex image generation response exceeded the event limit",
      );
    }
  }
  return events;
}

function decodeImageResult(result: string): Buffer {
  const payload = result.startsWith("data:")
    ? result.slice(result.indexOf(",") + 1)
    : result;
  if (
    payload.length === 0 ||
    payload.length > MAX_IMAGE_BASE64_CHARS ||
    payload.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(payload)
  ) {
    throw new Error("Codex image generation returned malformed image data");
  }
  const data = Buffer.from(payload, "base64");
  if (data.length === 0) {
    throw new Error("Codex image generation returned empty image data");
  }
  return data;
}

function extractImage(body: string): { data: Buffer; revisedPrompt?: string } {
  const outputItems: CodexImageItem[] = [];
  let completedOutput: CodexImageItem[] | undefined;
  let completed = false;
  for (const event of parseEvents(body)) {
    if (event.type === "response.failed" || event.type === "error") {
      const error = event.response?.error ?? event.error;
      throw new Error(
        error?.message ??
          event.message ??
          (error?.code
            ? `Codex image generation failed (${error.code})`
            : "Codex image generation failed"),
      );
    }
    if (event.type === "response.incomplete") {
      throw new Error(
        `Codex image generation response incomplete: ${event.response?.incomplete_details?.reason ?? "unknown"}`,
      );
    }
    if (
      event.type === "response.output_item.done" &&
      event.item?.type === "image_generation_call"
    ) {
      outputItems.push(event.item);
    }
    if (event.type === "response.completed") {
      completed = true;
      completedOutput = event.response?.output;
      break;
    }
  }

  if (!completed) {
    throw new Error(
      "Codex image generation stream closed before response.completed",
    );
  }

  const item = (completedOutput?.length ? completedOutput : outputItems).find(
    (candidate) => candidate.type === "image_generation_call",
  );
  if (!item || item.status === "failed") {
    throw new Error("Codex image generation completed without an image");
  }
  if (item.status && item.status !== "completed") {
    throw new Error(
      `Codex image generation image call did not complete (${item.status})`,
    );
  }
  if (!item.result) {
    throw new Error("Codex image generation completed without image data");
  }
  return {
    data: decodeImageResult(item.result),
    ...(item.revised_prompt ? { revisedPrompt: item.revised_prompt } : {}),
  };
}

export function createCodexImageProvider(
  _env: Env,
  model: string = DEFAULT_CODEX_IMAGE_MODEL,
): ImageProvider {
  const selectedModel = model.trim() || DEFAULT_CODEX_IMAGE_MODEL;
  return {
    id: "codex",
    model: selectedModel,
    supportsImageEditing: true,
    async generateImage(input): Promise<GenerateImageResult> {
      const reference = input.referenceImage;
      if (reference && (!reference.data.length || reference.data.length > MAX_RESPONSE_BYTES)) {
        throw new Error("Codex image editing requires a nonempty reference image within the size limit");
      }
      const request = async (requestModel: string): Promise<GenerateImageResult> => {
        input.signal?.throwIfAborted();
        const size = imageSize(input, requestModel);
        await input.onProgress?.({ stage: "requesting" });
        const response = await codexFetch(`${CODEX_BACKEND_BASE_URL}/responses`, {
          method: "POST",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
          },
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(CODEX_IMAGE_TIMEOUT_MS)])
            : AbortSignal.timeout(CODEX_IMAGE_TIMEOUT_MS),
          body: JSON.stringify({
            model: CODEX_IMAGE_RESPONSES_MODEL,
            input: [
              {
                role: "user",
                content: [
                  {
                    type: "input_text",
                    text: wrapImageGenerationPrompt(input, { transparent: true }),
                  },
                  ...(reference ? [{
                    type: "input_image",
                    image_url: `data:${reference.mimeType};base64,${reference.data.toString("base64")}`,
                    detail: "high",
                  }] : []),
                ],
              },
            ],
            instructions: "You are an image generation assistant.",
            tools: [
              {
                type: "image_generation",
                model: requestModel,
                size,
                ...(reference ? {action: "edit"} : {}),
              },
            ],
            tool_choice: { type: "image_generation" },
            stream: true,
            store: false,
          }),
        });
        if (!response.ok) {
          const detail = (await readResponseBody(response)).slice(0, 400);
          throw new CodexBackendError(
            `Codex image generation failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`,
            response.status,
          );
        }
        await input.onProgress?.({ stage: "generating" });
        const image = extractImage(await readResponseBody(response));
        await input.onProgress?.({ stage: "downloading" });
        return {
          data: image.data,
          mimeType: "image/png",
          meta: {
            provider: "codex",
            model: requestModel,
            responsesModel: CODEX_IMAGE_RESPONSES_MODEL,
            size,
            ...(reference ? {action: "edit"} : {}),
            ...(image.revisedPrompt
              ? { revisedPrompt: image.revisedPrompt }
              : {}),
          },
        };
      };
      try {
        return await request(selectedModel);
      } catch (error) {
        // A provider-wide busy response has produced no usable image. Try the
        // already supported compatible model once, without changing settings or
        // retrying validation/auth/quota failures. Preserve the same edit pixels.
        input.signal?.throwIfAborted();
        if (selectedModel !== "gpt-image-2.5-flare" || !(error instanceof Error)
          || !/servers? (?:are )?(?:currently )?overloaded|server_overloaded|HTTP (?:503|529)/i.test(error.message)) throw error;
        const result = await request("gpt-image-2");
        return {...result, meta: {...result.meta, requestedModel: selectedModel, fallbackReason: "provider-overloaded"}};
      }
    },
  };
}
