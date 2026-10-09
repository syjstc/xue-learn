import type { Env } from "../../env.js";
import { wrapImageGenerationPrompt } from "../prompt-language.js";
import type {
  GenerateImageInput,
  GenerateImageResult,
  ImageAspectRatio,
  ImageProvider,
} from "./types.js";

/** Seedream recommended 1K pixel sizes by aspect ratio. */
const SEEDREAM_1K_SIZE_BY_ASPECT: Record<ImageAspectRatio, string> = {
  "1:1": "1024x1024",
  "4:3": "1152x864",
  "3:4": "864x1152",
  "16:9": "1280x720",
  "9:16": "720x1280",
  "3:2": "1248x832",
  "2:3": "832x1248",
};

/** Seedream recommended 2K pixel sizes by aspect ratio. */
const SEEDREAM_2K_SIZE_BY_ASPECT: Record<ImageAspectRatio, string> = {
  "1:1": "2048x2048",
  "4:3": "2304x1728",
  "3:4": "1728x2304",
  "16:9": "2848x1600",
  "9:16": "1600x2848",
  "3:2": "2496x1664",
  "2:3": "1664x2496",
};

type SeedreamStreamEvent = {
  type?: string;
  url?: string;
  b64_json?: string;
  size?: string;
  error?: { code?: string; message?: string };
  usage?: Record<string, unknown>;
};

export function seedream1kSize(aspectRatio?: ImageAspectRatio): string {
  return SEEDREAM_1K_SIZE_BY_ASPECT[aspectRatio ?? "1:1"] ?? "1024x1024";
}

export function seedream2kSize(aspectRatio?: ImageAspectRatio): string {
  return SEEDREAM_2K_SIZE_BY_ASPECT[aspectRatio ?? "1:1"] ?? "2048x2048";
}

function doubaoBaseUrl(env: Env): string {
  return env.DOUBAO_BASE_URL.replace(/\/$/, "");
}

async function readSeedreamStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: GenerateImageInput["onProgress"],
): Promise<{ event: SeedreamStreamEvent; usage?: Record<string, unknown> }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let usage: Record<string, unknown> | undefined;
  let partialFailed: SeedreamStreamEvent | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");

        const line = rawLine.trimEnd();
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let event: SeedreamStreamEvent;
        try {
          event = JSON.parse(payload) as SeedreamStreamEvent;
        } catch {
          continue;
        }

        if (event.type === "image_generation.partial_succeeded") {
          if (event.url || event.b64_json) {
            await onProgress?.({
              stage: event.url ? "downloading" : "generating",
              ...(event.url ? { previewUrl: event.url } : {}),
            });
            return { event, usage };
          }
        }

        if (event.type === "image_generation.partial_failed") {
          partialFailed = event;
        }

        if (event.type === "image_generation.completed") {
          usage = event.usage;
        }

        if (
          event.error?.message &&
          !event.type?.startsWith("image_generation.")
        ) {
          throw new Error(
            `Doubao Seedream stream error ${event.error.code ?? ""}: ${event.error.message}`.trim(),
          );
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (partialFailed?.error?.message) {
    throw new Error(
      `Doubao Seedream image failed ${partialFailed.error.code ?? ""}: ${partialFailed.error.message}`.trim(),
    );
  }

  throw new Error("Doubao Seedream stream ended without an image");
}

export function createDoubaoImageProvider(
  env: Env,
  model: string,
): ImageProvider {
  return {
    id: "doubao",
    model,
    async generateImage(
      input: GenerateImageInput,
    ): Promise<GenerateImageResult> {
      const size =
        input.resolution === "1k" ||
        (input.compact && input.resolution !== "2k")
          ? seedream1kSize(input.aspectRatio)
          : seedream2kSize(input.aspectRatio);
      const apiUrl = `${doubaoBaseUrl(env)}/images/generations`;

      // Seedream 5.0 has no background parameter — transparency comes from
      // output_format png plus the prompt contract. Fall back to the legacy
      // JPEG paper canvas if the request is rejected.
      const buildBody = (transparent: boolean) => ({
        model,
        prompt: wrapImageGenerationPrompt(input, { transparent }),
        // 生成单图 — Volcengine Ark Seedream 5.0 lite
        sequential_image_generation: "disabled",
        size,
        output_format: transparent ? "png" : "jpeg",
        response_format: "url",
        stream: true,
        watermark: false,
      });
      const request = (transparent: boolean) =>
        fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.DOUBAO_API_KEY!}`,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify(buildBody(transparent)),
          signal: input.signal
            ? AbortSignal.any([input.signal, AbortSignal.timeout(180_000)])
            : AbortSignal.timeout(180_000),
        });

      await input.onProgress?.({ stage: "requesting" });
      let transparent = true;
      let res = await request(true);
      if (res.status === 400 || res.status === 422) {
        transparent = false;
        res = await request(false);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `Doubao Seedream image API HTTP ${res.status}: ${body.slice(0, 400)}`,
        );
      }

      if (!res.body) {
        throw new Error("Doubao Seedream image API returned an empty body");
      }

      await input.onProgress?.({ stage: "generating" });
      const { event, usage } = await readSeedreamStream(
        res.body,
        input.onProgress,
      );

      if (event.b64_json) {
        return {
          data: Buffer.from(event.b64_json, "base64"),
          mimeType: transparent ? "image/png" : "image/jpeg",
          meta: {
            provider: "doubao",
            model,
            size: event.size ?? size,
            transparent,
            usage,
          },
        };
      }

      if (!event.url) {
        throw new Error("Doubao Seedream stream returned no image URL");
      }

      const imgRes = await fetch(event.url, {
        signal: input.signal
          ? AbortSignal.any([input.signal, AbortSignal.timeout(60_000)])
          : AbortSignal.timeout(60_000),
      });
      if (!imgRes.ok) {
        throw new Error(
          `Failed to download Doubao Seedream image: HTTP ${imgRes.status}`,
        );
      }

      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mimeType =
        imgRes.headers.get("content-type") ??
        (transparent ? "image/png" : "image/jpeg");
      return {
        data: buf,
        mimeType,
        meta: {
          provider: "doubao",
          model,
          size: event.size ?? size,
          sourceUrl: event.url,
          transparent,
          usage,
        },
      };
    },
  };
}
