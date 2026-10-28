import type { Env } from "../../env.js";
import {
  krillImageBaseUrls,
  krillRoutedImageModel,
} from "../../providers/image/vendors/krill/options.js";
import { wrapImageGenerationPrompt } from "../prompt-language.js";
import type {
  GenerateImageInput,
  GenerateImageResult,
  ImageAspectRatio,
  ImageProvider,
} from "./types.js";

type KrillImageResponse = {
  id?: string;
  object?: string;
  status?: string;
  content_url?: string;
  message?: string;
  error?: { message?: string } | string;
  data?: Array<{ b64_json?: string; url?: string }>;
};

const SIZE_1K: Record<ImageAspectRatio, string> = {
  "1:1": "1024x1024",
  "16:9": "1536x1024",
  "9:16": "1024x1536",
  "4:3": "1536x1024",
  "3:4": "1024x1536",
  "3:2": "1536x1024",
  "2:3": "1024x1536",
};

/** gpt-image-2 2K sizes (edges multiples of 16). */
const SIZE_2K: Record<ImageAspectRatio, string> = {
  "1:1": "2048x2048",
  "16:9": "2560x1440",
  "9:16": "1440x2560",
  "4:3": "2048x1536",
  "3:4": "1536x2048",
  "3:2": "2048x1360",
  "2:3": "1360x2048",
};

function krillErrorMessage(
  payload: KrillImageResponse | undefined,
  fallback: string,
) {
  if (!payload) return fallback;
  if (typeof payload.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  if (
    payload.error &&
    typeof payload.error === "object" &&
    payload.error.message
  ) {
    return payload.error.message;
  }
  if (typeof payload.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  return fallback;
}

export function krillImageSize(
  aspectRatio?: ImageAspectRatio,
  tier: "1k" | "2k" = "2k",
): string {
  const ratio = aspectRatio ?? "1:1";
  if (tier === "1k") return SIZE_1K[ratio] ?? "1024x1024";
  return SIZE_2K[ratio] ?? "2048x2048";
}

export function krillImageQuality(): "high" {
  return "high";
}

/** Krill's edge gateway kills in-flight sync generates at ~100s with HTTP 500. */
const KRILL_POLL_WAIT_MS = 300_000;
/** Real async creates return in seconds. A long wait means `async` was ignored. */
const KRILL_CREATE_WAIT_MS = 20_000;

function isTimeoutAbort(cause: unknown): boolean {
  const error = cause as { name?: string; message?: string };
  const name = String(error?.name ?? "");
  const message = String(error?.message ?? cause ?? "");
  return (
    name === "TimeoutError" ||
    name === "AbortError" ||
    /aborted due to timeout|the operation was aborted/i.test(message)
  );
}

function krillApiError(status: number, detail: string): Error & { status: number } {
  const error = new Error(
    `Krill image API HTTP ${status}: ${detail.slice(0, 400)}`,
  ) as Error & { status: number };
  error.status = status;
  return error;
}

function shouldFailoverHost(status: number): boolean {
  return (
    status === 408 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504 ||
    status === 524
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseKrillResponse(res: Response): Promise<{
  json: KrillImageResponse | undefined;
  text: string;
}> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) return { json: undefined, text };
  try {
    return { json: JSON.parse(text) as KrillImageResponse, text };
  } catch {
    return { json: undefined, text };
  }
}

async function downloadImage(
  url: string,
  apiKey: string,
): Promise<{ data: Buffer; mimeType: string }> {
  const imgRes = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    redirect: "follow",
    signal: AbortSignal.timeout(KRILL_POLL_WAIT_MS),
  });
  if (!imgRes.ok) {
    const body = await imgRes.text().catch(() => "");
    throw new Error(
      `Krill image download HTTP ${imgRes.status}: ${body.slice(0, 400)}`,
    );
  }
  return {
    data: Buffer.from(await imgRes.arrayBuffer()),
    mimeType: imgRes.headers.get("content-type") ?? "image/png",
  };
}

async function decodeSyncResult(
  json: KrillImageResponse,
  apiKey: string,
): Promise<{ data: Buffer; mimeType: string } | null> {
  const b64 = json.data?.[0]?.b64_json;
  if (b64) {
    return { data: Buffer.from(b64, "base64"), mimeType: "image/png" };
  }
  const url = json.data?.[0]?.url;
  if (url) return downloadImage(url, apiKey);
  return null;
}

async function pollKrillImage(
  baseUrl: string,
  apiKey: string,
  imageId: string,
  onProgress?: GenerateImageInput["onProgress"],
): Promise<{ data: Buffer; mimeType: string }> {
  const deadline = Date.now() + KRILL_POLL_WAIT_MS;
  while (Date.now() < deadline) {
    await onProgress?.({ stage: "generating" });
    const res = await fetch(
      `${baseUrl}/images/${encodeURIComponent(imageId)}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
    const { json, text } = await parseKrillResponse(res);
    if (!res.ok) {
      throw krillApiError(
        res.status,
        krillErrorMessage(json, text),
      );
    }
    if (json?.status === "failed" || (json?.error && json.error !== null)) {
      throw new Error(
        `Krill image generation failed: ${krillErrorMessage(json, "unknown error")}`,
      );
    }
    if (json?.status === "completed") {
      await onProgress?.({ stage: "downloading" });
      return downloadImage(
        `${baseUrl}/images/${encodeURIComponent(imageId)}/content`,
        apiKey,
      );
    }
    await sleep(3_000);
  }
  throw new Error(`Krill image generation timed out for ${imageId}`);
}

export function createKrillImageProvider(env: Env, model: string): ImageProvider {
  const routedModel = krillRoutedImageModel(model);
  return {
    id: "krill",
    model: routedModel,
    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      const apiKey = env.KRILL_API_KEY!;
      const quality = krillImageQuality();
      const tutorialPrompt = input.compact
        ? input.prompt.trim()
        : wrapImageGenerationPrompt(input, { transparent: true });
      const hosts = krillImageBaseUrls(env.KRILL_IMAGE_BASE_URL);
      const sizeTiers: Array<"2k" | "1k"> =
        input.compact || input.resolution === "1k" ? ["1k"] : ["2k", "1k"];

      const createBodies = (size: string): Record<string, unknown>[] => [
        {
          model: routedModel,
          prompt: tutorialPrompt,
          size,
          quality,
          response_format: "url",
          n: 1,
          async: true,
        },
        {
          model: routedModel,
          prompt: tutorialPrompt,
          size,
          quality,
          n: 1,
          async: true,
        },
        {
          model: routedModel,
          prompt: tutorialPrompt,
          size,
          async: true,
        },
      ];

      const requestAsync = (baseUrl: string, body: Record<string, unknown>) =>
        fetch(`${baseUrl}/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(KRILL_CREATE_WAIT_MS),
        });

      await input.onProgress?.({ stage: "requesting" });

      let lastError: Error | undefined;
      hostLoop: for (const baseUrl of hosts) {
        for (const tier of sizeTiers) {
          const size = krillImageSize(input.aspectRatio, tier);
          for (const body of createBodies(size)) {
            let res: Response;
            try {
              res = await requestAsync(baseUrl, body);
            } catch (cause) {
              if (!isTimeoutAbort(cause)) throw cause;
              lastError = new Error(
                `Krill image create hung after 20s (${baseUrl}, size=${size}). async may be ignored; size/quality/response_format may be invalid.`,
              );
              continue;
            }
            const { json, text } = await parseKrillResponse(res);
            if (res.status === 400 || res.status === 422) {
              lastError = krillApiError(
                res.status,
                krillErrorMessage(json, text),
              );
              continue;
            }
            if (shouldFailoverHost(res.status)) {
              lastError = krillApiError(
                res.status,
                krillErrorMessage(json, text),
              );
              continue hostLoop;
            }
            if (!res.ok) {
              throw krillApiError(res.status, krillErrorMessage(json, text));
            }
            if (!json) {
              throw new Error("Krill image API returned no image data");
            }
            const errorMessage = krillErrorMessage(json, "");
            if (errorMessage) {
              throw new Error(`Krill image API: ${errorMessage}`);
            }

            const sync = await decodeSyncResult(json, apiKey);
            if (sync) {
              return {
                data: sync.data,
                mimeType: sync.mimeType,
                meta: {
                  provider: "krill",
                  model: routedModel,
                  async: true,
                  size,
                  baseUrl,
                },
              };
            }

            const imageId = json.id;
            if (!imageId) {
              throw new Error("Krill image API returned no image data");
            }

            const downloaded = await pollKrillImage(
              baseUrl,
              apiKey,
              imageId,
              input.onProgress,
            );
            return {
              data: downloaded.data,
              mimeType: downloaded.mimeType,
              meta: {
                provider: "krill",
                model: routedModel,
                imageId,
                async: true,
                size,
                baseUrl,
              },
            };
          }
        }
      }
      throw lastError ?? new Error("Krill image API returned no image data");
    },
  };
}
