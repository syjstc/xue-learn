import type { Env } from "../../env.js";
import { compactImagePixelSize } from "../compact-dimensions.js";
import { wrapImageGenerationPrompt } from "../prompt-language.js";
import type { GenerateImageInput, GenerateImageResult, ImageProvider } from "./types.js";

type MinimaxImageResponse = {
  base_resp?: { status_code?: number; status_msg?: string };
  data?: {
    image_base64?: string[];
    image_urls?: string[];
  };
};

function imageApiHost(env: Env): string {
  const base = env.MINIMAX_BASE_URL.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  return base;
}

export function createMinimaxImageProvider(env: Env, model: string): ImageProvider {
  return {
    id: "minimax",
    model,
    async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
      const apiUrl = `${imageApiHost(env)}/v1/image_generation`;
      const geometry: Record<string, unknown> = {};
      if (input.compact && input.resolution !== "2k") {
        const { width, height } = compactImagePixelSize(input.aspectRatio);
        geometry.width = width;
        geometry.height = height;
      } else if (input.aspectRatio) {
        geometry.aspect_ratio = input.aspectRatio;
      }
      const buildPayload = (transparent: boolean) => ({
        model,
        prompt: wrapImageGenerationPrompt(input, { transparent }),
        response_format: "base64",
        n: 1,
        prompt_optimizer: true,
        aigc_watermark: false,
        // image-01 writes a real alpha channel when asked explicitly; fall
        // back to the paper canvas if the endpoint rejects the parameter.
        ...(transparent ? { transparent_background: true } : {}),
        ...geometry,
      });
      const request = (transparent: boolean) =>
        fetch(apiUrl, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.MINIMAX_API_KEY!}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildPayload(transparent)),
          signal: AbortSignal.timeout(120_000),
        });

      let transparent = true;
      let res = await request(true);
      if (res.status === 400 || res.status === 422) {
        transparent = false;
        res = await request(false);
      }

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`MiniMax image API HTTP ${res.status}: ${body.slice(0, 400)}`);
      }

      const json = (await res.json()) as MinimaxImageResponse;
      const statusCode = json.base_resp?.status_code ?? 0;
      if (statusCode !== 0) {
        throw new Error(
          `MiniMax image API error ${statusCode}: ${json.base_resp?.status_msg ?? "unknown"}`
        );
      }

      const b64 = json.data?.image_base64?.[0];
      if (b64) {
        return {
          data: Buffer.from(b64, "base64"),
          mimeType: "image/png",
          meta: { provider: "minimax", model, transparent },
        };
      }

      const url = json.data?.image_urls?.[0];
      if (url) {
        const imgRes = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!imgRes.ok) {
          throw new Error(`Failed to download MiniMax image: HTTP ${imgRes.status}`);
        }
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const mimeType = imgRes.headers.get("content-type") ?? "image/png";
        return { data: buf, mimeType, meta: { provider: "minimax", model, transparent, sourceUrl: url } };
      }

      throw new Error("MiniMax image API returned no image data");
    },
  };
}
