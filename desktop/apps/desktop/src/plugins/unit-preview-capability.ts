/** A completed stream is required before Video may consume the published preview. */
export class UnitPreviewCapabilityError extends Error {
  constructor(message: string, private readonly status: number) { super(message); }
  getStatus() { return this.status; }
}

export async function readCompletedUnitPreview(response: Response, signal: AbortSignal): Promise<{complete: true}> {
  if (!response.ok) {
    const value = await response.json().catch(() => ({})) as {message?: string | string[]};
    const message = Array.isArray(value.message) ? value.message.join('；') : value.message;
    throw new UnitPreviewCapabilityError(message || `预习准备请求失败（${response.status}）`, response.status);
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body)
    throw new UnitPreviewCapabilityError('预习准备响应中断，等待自动继续', 503);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', completed = false;
  let failure: UnitPreviewCapabilityError | undefined;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      signal.throwIfAborted();
      const {value, done} = await reader.read();
      signal.throwIfAborted();
      buffer += decoder.decode(value, {stream: !done}).replace(/\r/g, '');
      let at: number;
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, at); buffer = buffer.slice(at + 2);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        let event: {type?: string; message?: string; error?: string};
        try { event = JSON.parse(data); } catch { continue; }
        if (event.type === 'error') failure = new UnitPreviewCapabilityError(event.message || event.error || '预习生成失败', 400);
        if (event.type === 'done') completed = true;
      }
      if (buffer.length > 16_000_000) throw new UnitPreviewCapabilityError('预习准备消息超出上限', 400);
      if (done) break;
    }
    if (failure) throw failure;
    if (!completed) throw new UnitPreviewCapabilityError('预习准备响应中断，等待自动继续', 503);
    return {complete: true};
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof TypeError) throw new UnitPreviewCapabilityError('预习准备连接中断，等待自动继续', 503);
    throw error;
  } finally {
    signal.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
