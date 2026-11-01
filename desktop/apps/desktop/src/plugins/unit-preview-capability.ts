/** A completed stream is required before Video may consume the published preview. */
const previewMessages = {
  en: {
    requestFailed: "Could not prepare the lesson preview",
    interrupted:
      "Preview preparation was interrupted; waiting to resume automatically",
    failed: "Could not generate the lesson preview",
    tooLarge: "The preview response exceeded the supported size",
    disconnected:
      "The preview connection was lost; waiting to resume automatically",
    timeout: "Preview preparation timed out; waiting to resume automatically",
  },
  "zh-Hans": {
    requestFailed: "预习准备请求失败",
    interrupted: "预习准备响应中断，等待自动继续",
    failed: "预习生成失败",
    tooLarge: "预习准备消息超出上限",
    disconnected: "预习准备连接中断，等待自动继续",
    timeout: "预习准备响应超时，等待自动继续",
  },
  "zh-Hant": {
    requestFailed: "預習準備請求失敗",
    interrupted: "預習準備回應中斷，等待自動繼續",
    failed: "預習產生失敗",
    tooLarge: "預習準備訊息超出上限",
    disconnected: "預習準備連線中斷，等待自動繼續",
    timeout: "預習準備回應逾時，等待自動繼續",
  },
};
export function unitPreviewMessage(
  locale: string | undefined,
  key: keyof typeof previewMessages.en,
): string {
  return previewMessages[
    locale === "en" || locale === "zh-Hant" ? locale : "zh-Hans"
  ][key];
}

export class UnitPreviewCapabilityError extends Error {
  constructor(
    message: string,
    private readonly status: number,
  ) {
    super(message);
  }
  getStatus() {
    return this.status;
  }
}

export async function readCompletedUnitPreview(
  response: Response,
  signal: AbortSignal,
  locale = "zh-Hans",
): Promise<{ complete: true }> {
  if (!response.ok) {
    const value = (await response.json().catch(() => ({}))) as {
      message?: string | string[];
    };
    const message = Array.isArray(value.message)
      ? value.message.join("；")
      : value.message;
    throw new UnitPreviewCapabilityError(
      message ||
        `${unitPreviewMessage(locale, "requestFailed")} (${response.status})`,
      response.status,
    );
  }
  if (
    !response.headers.get("content-type")?.includes("text/event-stream") ||
    !response.body
  )
    throw new UnitPreviewCapabilityError(
      unitPreviewMessage(locale, "interrupted"),
      503,
    );
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    completed = false;
  let failure: UnitPreviewCapabilityError | undefined;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, { stream: !done }).replace(/\r/g, "");
      let at: number;
      while ((at = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let event: { type?: string; message?: string; error?: string };
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.type === "error")
          failure = new UnitPreviewCapabilityError(
            event.message ||
              event.error ||
              unitPreviewMessage(locale, "failed"),
            400,
          );
        if (event.type === "done") completed = true;
      }
      if (buffer.length > 16_000_000)
        throw new UnitPreviewCapabilityError(
          unitPreviewMessage(locale, "tooLarge"),
          400,
        );
      if (done) break;
    }
    if (failure) throw failure;
    if (!completed)
      throw new UnitPreviewCapabilityError(
        unitPreviewMessage(locale, "interrupted"),
        503,
      );
    return { complete: true };
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof TypeError)
      throw new UnitPreviewCapabilityError(
        unitPreviewMessage(locale, "disconnected"),
        503,
      );
    throw error;
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
