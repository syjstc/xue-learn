import type { Env } from "../../env.js";
import { compactImagePixelSize } from "../compact-dimensions.js";
import { wrapImageGenerationPrompt } from "../prompt-language.js";
import type { GenerateImageInput, GenerateImageResult, ImageProvider } from "./types.js";

type ApimartSubmitResponse = {
  code?: number;
  data?: Array<{ status?: string; task_id?: string }>;
  error?: { message?: string };
};

type ApimartTaskResponse = {
  code?: number;
  data?: {
    status?: string;
    progress?: number;
    result?: {
      images?: Array<{ url?: string[] }>;
    };
    error?: { message?: string };
  };
  error?: { message?: string };
};

function apimartBaseUrl(env: Env): string {
  return (env.APIMART_BASE_URL ?? "https://api.apimart.ai").replace(/\/$/, "");
}

function apimartSize(aspectRatio?: GenerateImageInput["aspectRatio"]): string {
  return aspectRatio ?? "1:1";
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollApimartTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<string> {
  const deadline = Date.now() + 120_000;
  await sleep(12_000);

  while (Date.now() < deadline) {
    const res = await fetch(`${baseUrl}/v1/tasks/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`APIMart task API HTTP ${res.status}: ${body.slice(0, 400)}`);
    }

    const json = (await res.json()) as ApimartTaskResponse;
    if (json.error?.message) {
      throw new Error(`APIMart task API: ${json.error.message}`);
    }

    const status = json.data?.status;
    if (status === "completed") {
      const url = json.data?.result?.images?.[0]?.url?.[0];
      if (!url) {
        throw new Error("APIMart task completed but returned no image URL");
      }
      return url;
    }

    if (status === "failed") {
      throw new Error(
        `APIMart image generation failed: ${json.data?.error?.message ?? "unknown error"}`,
      );
    }

    await sleep(4_000);
  }

  throw new Error(`APIMart image generation timed out for task ${taskId}`);
}

export function createApimartImageProvider(env: Env, model: string): ImageProvider {
  return {
    id: "apimart",
    model,
    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      const baseUrl = apimartBaseUrl(env);
      const apiKey = env.APIMART_API_KEY!;

      const useCompact = input.compact && input.resolution !== "2k";
      // gpt-image accepts `background: "transparent"` with PNG output; fall
      // back to the provider default (paper canvas) if the request is rejected.
      const buildBody = (transparent: boolean) => ({
        model,
        prompt: wrapImageGenerationPrompt(input, { transparent }),
        n: 1,
        ...(transparent ? { background: "transparent", output_format: "png" } : {}),
        ...(useCompact
          ? { size: compactImagePixelSize(input.aspectRatio).size }
          : {
              size: apimartSize(input.aspectRatio),
              resolution: input.resolution ?? "2k",
            }),
      });
      const request = (transparent: boolean) =>
        fetch(`${baseUrl}/v1/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildBody(transparent)),
          signal: AbortSignal.timeout(60_000),
        });

      let transparent = true;
      let res = await request(true);
      if (res.status === 400 || res.status === 422) {
        transparent = false;
        res = await request(false);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`APIMart image API HTTP ${res.status}: ${body.slice(0, 400)}`);
      }

      const json = (await res.json()) as ApimartSubmitResponse;
      if (json.error?.message) {
        throw new Error(`APIMart image API: ${json.error.message}`);
      }

      const taskId = json.data?.[0]?.task_id;
      if (!taskId) {
        throw new Error("APIMart image API returned no task_id");
      }

      const imageUrl = await pollApimartTask(baseUrl, apiKey, taskId);
      const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(60_000) });
      if (!imgRes.ok) {
        throw new Error(`Failed to download APIMart image: HTTP ${imgRes.status}`);
      }

      const buf = Buffer.from(await imgRes.arrayBuffer());
      const mimeType = imgRes.headers.get("content-type") ?? "image/png";
      return {
        data: buf,
        mimeType,
        meta: { provider: "apimart", model, taskId, sourceUrl: imageUrl, transparent },
      };
    },
  };
}
