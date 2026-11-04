import {randomUUID} from 'node:crypto';

/** One reconstructable model attempt in DSH's own persistence/export pipeline. */
export class ModelSession {
  constructor({sessions, persistence, cwd, config}) {
    this.sessions = sessions;
    this.persistence = persistence;
    this.stream = [];
    this.config = config;
    this.session = sessions.prepare(`xuelearn-${randomUUID()}`, {meta: {cwd}});
  }
  async open({adapterDefaults, messages, tools}) {
    // DSH persists only sessions with an acquired write handle. Ownership must
    // precede publication so its backend captures every subsequent event.
    this.handle = await this.persistence.create(this.session.header);
    try {
      this.detach = this.sessions.enter(this.session);
      this.sessions.announce(this.session);
      this.step = 1;
      this.session.append('turn/start', {turn: 1});
      this.session.append('step/start', {turn: 1, step: this.step});
      this.session.append('request/header', {reason: 'initial', header: {config: this.config,
        ...(Object.keys(adapterDefaults ?? {}).length ? {adapterDefaults} : {}),
        ...(tools?.length ? {tools} : {}),
      }});
      let historicalAssistant = false;
      const historicalCalls = new Map();
      for (const message of messages) {
        if (historicalAssistant && message.role !== 'tool') {
          this.nextStep(); historicalAssistant = false;
        }
        if (message.role === 'user') this.session.append('user/message', message, {surfaceOp: 'append'});
        else {
          const type = {system: 'system/message', assistant: 'assistant/message', tool: 'tool/result'}[message.role];
          if (message.role === 'tool') {
            const call = historicalCalls.get(message.toolCallId);
            if (!call) throw Error('Historical tool result has no matching call');
            this.session.append('tool/call', {turn: 1, step: this.step,
              callId: call.id, name: call.name, arguments: call.arguments});
            historicalCalls.delete(call.id);
          }
          // Core supplies historical messages, not their original provider streams.
          // Only this call's new output has a captured stream and token usage.
          this.session.append(type, {turn: 1, step: this.step, message,
            ...(message.role === 'assistant' ? {stream: []} : {}),
          }, {surfaceOp: 'append'});
          if (message.role === 'assistant') {
            historicalAssistant = true;
            for (const block of message.content) if (block.type === 'tool-call') historicalCalls.set(block.id, block);
          }
        }
      }
      if (historicalAssistant) this.nextStep();
    } catch (error) {this.detach?.(); await this.handle.close(); throw error;}
    return this;
  }
  get id() { return this.session.id; }
  nextStep() {
    this.session.append('step/end', {turn: 1, step: this.step});
    this.session.append('step/start', {turn: 1, step: ++this.step});
  }
  async flush() {
    await this.sessions.flush(this.session);
    await this.handle.flush();
  }
  chunk(chunk) {
    // Raw records are part of DSH's AssistantStreamRecord contract. Retain
    // reasoning, timing, usage and failures without sending them to Core/UI.
    this.stream.push({type: 'chunk', time: Date.now(), chunk: structuredClone(chunk)});
    if (chunk.type === 'usage') this.usage = chunk.usage;
  }
  async finish({content, error, aborted = false, finish}) {
    if (this.closed) return;
    this.closed = true;
    try {
      // Core executes these tool calls after IPC returns. A diagnostic DSH
      // session must not claim it executed them, or close unresolved calls on
      // its conversation surface. The native attempt keeps their exact stream.
      if (error || content?.some(block => block.type === 'tool-call')) {
        this.session.append('assistant/attempt', {turn: 1, step: this.step, stream: this.stream});
      }
      else this.session.append('assistant/message', {turn: 1, step: this.step,
        message: {id: randomUUID(), role: 'assistant', content,
          source: {kind: 'model', provider: this.config.provider, model: this.config.model}},
        stream: this.stream, ...(this.usage ? {usage: this.usage} : {}),
      }, {surfaceOp: 'append'});
      this.session.append('step/end', {turn: 1, step: this.step});
      this.session.append('turn/end', {turn: 1, reason: error
        ? aborted ? {kind: 'aborted', reason: {kind: 'parent'}}
          : {kind: 'error', error: {message: error.message, code: 'XUELEARN_MODEL_ERROR'}}
        : {kind: finish?.kind === 'max-tokens' ? 'max-tokens' : 'completed'}});
      await this.flush();
    } finally {this.detach(); await this.handle.close();}
  }
}
