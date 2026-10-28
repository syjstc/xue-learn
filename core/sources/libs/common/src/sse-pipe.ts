type SseWritableResponse = {
  writableEnded: boolean;
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  write(chunk: Uint8Array): boolean;
  end(): unknown;
  flushHeaders?(): unknown;
  flush?(): unknown;
  once(event: "close" | "drain", listener: () => void): unknown;
  off(event: "close" | "drain", listener: () => void): unknown;
};

/** Pipes a Web ReadableStream to Express with backpressure and disconnect cleanup. */
export async function pipeWebSseResponse(
  webResponse: globalThis.Response,
  res: SseWritableResponse,
): Promise<void> {
  res.status(webResponse.status);
  webResponse.headers.forEach((value, key) => res.setHeader(key, value));
  res.flushHeaders?.();

  if (!webResponse.body) {
    res.end();
    return;
  }

  const reader = webResponse.body.getReader();
  let disconnected = false;
  const onClose = () => {
    disconnected = true;
    void reader.cancel("downstream disconnected").catch(() => undefined);
  };
  res.once("close", onClose);

  try {
    while (!disconnected) {
      const { done, value } = await reader.read();
      if (done || disconnected) break;
      const canContinue = res.write(Buffer.from(value));
      // compression middleware may otherwise hold small SSE frames until its
      // normal output threshold is reached.
      res.flush?.();
      if (!canContinue) {
        await new Promise<void>((resolve) => {
          const finish = () => {
            res.off("drain", finish);
            res.off("close", finish);
            resolve();
          };
          res.once("drain", finish);
          res.once("close", finish);
        });
      }
    }
  } finally {
    res.off("close", onClose);
    reader.releaseLock();
    if (!disconnected && !res.writableEnded) res.end();
  }
}
