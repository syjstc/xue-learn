/** Decode live SSE messages without buffering the response until generation ends. */
export async function consumeEventStream(response, onMessage, signal, initialEventId = '') {
  if (!response.ok) throw Error(`Learning events failed (${response.status})`);
  const reader = response.body?.getReader();
  if (!reader) throw Error('Learning event stream is missing');
  const decoder = new TextDecoder();
  let pending = '', data = [], eventType = 'message', lastEventId = initialEventId, eventSize = 0;
  const cancel = () => {void reader.cancel().catch(() => {});};
  signal?.addEventListener('abort', cancel, {once: true});
  const line = value => {
    if (!value) {
      if (data.length) onMessage({data: data.join('\n'), type: eventType, lastEventId});
      data = []; eventType = 'message'; eventSize = 0;
      return;
    }
    if (value.startsWith(':')) return;
    const separator = value.indexOf(':');
    const field = separator < 0 ? value : value.slice(0, separator);
    const content = (separator < 0 ? '' : value.slice(separator + 1)).replace(/^ /, '');
    if (field === 'data') {data.push(content); eventSize += content.length;}
    if (field === 'event') eventType = content || 'message';
    if (field === 'id' && !content.includes('\0')) lastEventId = content;
    if (eventSize > 8 * 1024 * 1024) throw Error('Learning event is too large');
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      const {done, value} = await reader.read();
      signal?.throwIfAborted();
      pending += done ? decoder.decode() : decoder.decode(value, {stream: true});
      let start = 0;
      for (let index = 0; index < pending.length; index++) {
        const character = pending[index];
        if (character !== '\r' && character !== '\n') continue;
        if (character === '\r' && index === pending.length - 1 && !done) break;
        line(pending.slice(start, index));
        if (character === '\r' && pending[index + 1] === '\n') index++;
        start = index + 1;
      }
      pending = pending.slice(start);
      if (pending.length > 8 * 1024 * 1024) throw Error('Learning event buffer is too large');
      if (done) return;
    }
  } finally {
    signal?.removeEventListener('abort', cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function reconnectDelay(milliseconds, signal) {
  return new Promise(resolve => {
    const finish = () => {clearTimeout(timer); signal.removeEventListener('abort', finish); resolve();};
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener('abort', finish, {once: true});
    if (signal.aborted) finish();
  });
}

/** EventSource semantics over the host's authenticated streaming fetch carrier. */
export class AuthenticatedEventSource {
  onmessage = null;
  onerror = null;
  #controller = new AbortController();
  constructor(path, {fetch, retryMs = 1000}) {
    this.path = path;
    this.fetch = fetch;
    this.retryMs = retryMs;
    void this.#run();
  }
  close() {this.#controller.abort();}
  async #run() {
    const {signal} = this.#controller;
    let lastEventId = '';
    while (!signal.aborted) {
      try {
        const response = await this.fetch(this.path, {signal,
          headers: {Accept: 'text/event-stream', ...(lastEventId ? {'Last-Event-ID': lastEventId} : {})}});
        await consumeEventStream(response, message => {
          if (signal.aborted) return;
          lastEventId = message.lastEventId;
          if (message.type === 'message') this.onmessage?.(message);
        }, signal, lastEventId);
      } catch (error) {
        if (!signal.aborted) this.onerror?.(error);
      }
      if (!signal.aborted) await reconnectDelay(this.retryMs, signal);
    }
  }
}
