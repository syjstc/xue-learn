import { pyodideIndexURL } from "./pyodide-url.js";

const RUN_TIMEOUT_MS = 8_000;
const MAX_CODE_CHARS = 32_000;

export type PythonConsoleStream = "stdout" | "stderr" | "result" | "system" | "stdin";

export type PythonConsoleLine = {
  stream: PythonConsoleStream;
  text: string;
};

type RuntimeListener = (event: PythonRuntimeEvent) => void;

export type PythonRuntimeEvent =
  | { type: "status"; status: "loading" | "ready" | "running" | "awaiting_input" }
  | { type: "line"; line: PythonConsoleLine }
  | { type: "done"; ok: boolean };

type WorkerOutbound =
  | { type: "ready" }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "stdin-request" }
  | { type: "result"; id: number; text: string }
  | { type: "error"; id: number; text: string }
  | { type: "done"; id: number };

export class DesktopPythonRuntime {
  private worker: Worker | null = null;
  private listeners = new Set<RuntimeListener>();
  private runId = 0;
  private ready = false;
  private timeout: number | null = null;
  private waitingForStdin = false;

  subscribe(listener: RuntimeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.clearTimeout();
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
    this.waitingForStdin = false;
    this.listeners.clear();
  }

  async run(code: string): Promise<void> {
    const trimmed = code.slice(0, MAX_CODE_CHARS);
    this.waitingForStdin = false;
    this.emit({ type: "status", status: this.ready ? "running" : "loading" });
    const worker = this.ensureWorker();
    const id = ++this.runId;
    if (!this.ready) {
      worker.postMessage({
        type: "init",
        indexURL: pyodideIndexURL(window.location.origin),
      });
    }
    worker.postMessage({ type: "run", id, code: trimmed });
    this.armTimeout(id);
  }

  interrupt(): void {
    if (!this.worker) return;
    this.emit({
      type: "line",
      line: { stream: "system", text: "Run interrupted.\n" },
    });
    this.restartWorker();
    this.emit({ type: "done", ok: false });
  }

  sendStdin(line: string): void {
    if (!this.worker || !this.waitingForStdin) return;
    const text = line.endsWith("\n") ? line : `${line}\n`;
    this.waitingForStdin = false;
    this.emit({ type: "line", line: { stream: "stdin", text } });
    this.emit({ type: "status", status: "running" });
    this.worker.postMessage({ type: "stdin", text });
    this.armTimeout(this.runId);
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(
      new URL("./python-runtime.worker.js", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
      const data = event.data;
      if (data.type === "ready") {
        this.ready = true;
        this.emit({ type: "status", status: this.runId > 0 ? "running" : "ready" });
        return;
      }
      if (data.type === "stdin-request") {
        this.waitingForStdin = true;
        this.clearTimeout();
        this.emit({ type: "status", status: "awaiting_input" });
        return;
      }
      if (data.type === "stdout" || data.type === "stderr") {
        this.emit({
          type: "line",
          line: { stream: data.type, text: data.text },
        });
        return;
      }
      if (data.type === "result") {
        if (data.id !== this.runId) return;
        this.emit({
          type: "line",
          line: { stream: "result", text: data.text },
        });
        return;
      }
      if (data.type === "error") {
        if (data.id !== this.runId && data.id !== 0) return;
        this.emit({
          type: "line",
          line: { stream: "stderr", text: data.text },
        });
        return;
      }
      if (data.type === "done") {
        if (data.id !== this.runId) return;
        this.waitingForStdin = false;
        this.clearTimeout();
        this.emit({ type: "done", ok: true });
      }
    };
    worker.onerror = (event) => {
      this.emit({
        type: "line",
        line: {
          stream: "stderr",
          text: `${event.message || "Python worker failed"}\n`,
        },
      });
      this.emit({ type: "done", ok: false });
    };
    this.worker = worker;
    return worker;
  }

  private restartWorker(): void {
    this.clearTimeout();
    this.waitingForStdin = false;
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private armTimeout(id: number): void {
    this.clearTimeout();
    this.timeout = window.setTimeout(() => {
      if (id !== this.runId || this.waitingForStdin) return;
      this.emit({
        type: "line",
        line: { stream: "system", text: "Timed out after 8s.\n" },
      });
      this.restartWorker();
      this.emit({ type: "done", ok: false });
    }, RUN_TIMEOUT_MS);
  }

  private clearTimeout(): void {
    if (this.timeout == null) return;
    window.clearTimeout(this.timeout);
    this.timeout = null;
  }

  private emit(event: PythonRuntimeEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
