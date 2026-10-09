/// <reference lib="webworker" />

type Inbound =
  | { type: "init"; indexURL: string }
  | { type: "run"; id: number; code: string }
  | { type: "stdin"; text: string };

type PyodideRuntime = {
  setStdout: (opts: { batched: (text: string) => void }) => void;
  setStderr: (opts: { batched: (text: string) => void }) => void;
  runPythonAsync: (code: string) => Promise<unknown>;
};

type PyodideModule = {
  loadPyodide: (options: { indexURL: string }) => Promise<PyodideRuntime>;
};

const STDIN_BOOTSTRAP = `
from pyodide.ffi import can_run_sync, run_sync
from js import xuelearnReadStdin
import sys

if not can_run_sync():
    raise RuntimeError("interactive stdin is unavailable")

class _XuelearnStdin:
    def readline(self, size=-1):
        line = str(run_sync(xuelearnReadStdin()))
        if line and not line.endswith("\\n"):
            line += "\\n"
        return line
    def read(self, size=-1):
        return self.readline()
    def isatty(self):
        return True

sys.stdin = _XuelearnStdin()
`.trim();

const STDIN_FALLBACK = `
import builtins, sys

def _xuelearn_input(prompt=""):
    if prompt:
        sys.stdout.write(str(prompt))
        sys.stdout.flush()
    raise EOFError("input() needs the desktop Python terminal")

builtins.input = _xuelearn_input
`.trim();

let indexURL = "";
let pyodide: PyodideRuntime | null = null;
let loading: Promise<void> | null = null;
let stdinWaiter: {
  resolve: (line: string) => void;
  reject: (error: Error) => void;
} | null = null;

function withTrailingSlash(url: string): string {
  return url.endsWith("/") ? url : `${url}/`;
}

function xuelearnReadStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (stdinWaiter) {
      stdinWaiter.reject(new Error("stdin replaced"));
    }
    stdinWaiter = { resolve, reject };
    self.postMessage({ type: "stdin-request" });
  });
}

(globalThis as typeof globalThis & { xuelearnReadStdin: typeof xuelearnReadStdin }).xuelearnReadStdin =
  xuelearnReadStdin;

function rejectStdin(message: string): void {
  if (!stdinWaiter) return;
  stdinWaiter.reject(new Error(message));
  stdinWaiter = null;
}

async function ensureRuntime(): Promise<PyodideRuntime> {
  if (pyodide) return pyodide;
  if (!indexURL) throw new Error("Python runtime index URL is missing");
  if (!loading) {
    loading = (async () => {
      const base = withTrailingSlash(indexURL);
      const mod = (await import(
        /* @vite-ignore */ `${base}pyodide.mjs`
      )) as PyodideModule;
      const runtime = await mod.loadPyodide({ indexURL: base });
      runtime.setStdout({
        batched: (text) => self.postMessage({ type: "stdout", text }),
      });
      runtime.setStderr({
        batched: (text) => self.postMessage({ type: "stderr", text }),
      });
      try {
        await runtime.runPythonAsync(STDIN_BOOTSTRAP);
      } catch {
        await runtime.runPythonAsync(STDIN_FALLBACK);
      }
      pyodide = runtime;
      self.postMessage({ type: "ready" });
    })();
  }
  await loading;
  if (!pyodide) throw new Error("Python runtime failed to start");
  return pyodide;
}

function formatError(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

self.onmessage = async (event: MessageEvent<Inbound>) => {
  const data = event.data;
  try {
    if (data.type === "stdin") {
      if (!stdinWaiter) return;
      const waiter = stdinWaiter;
      stdinWaiter = null;
      waiter.resolve(data.text);
      return;
    }
    if (data.type === "init") {
      indexURL = data.indexURL;
      await ensureRuntime();
      return;
    }
    const runtime = await ensureRuntime();
    try {
      const result = await runtime.runPythonAsync(data.code);
      if (result != null && result !== undefined) {
        self.postMessage({
          type: "result",
          id: data.id,
          text: `${String(result)}\n`,
        });
      }
    } catch (error) {
      self.postMessage({
        type: "error",
        id: data.id,
        text: `${formatError(error)}\n`,
      });
    } finally {
      rejectStdin("run finished");
    }
    self.postMessage({ type: "done", id: data.id });
  } catch (error) {
    rejectStdin("run failed");
    self.postMessage({
      type: "error",
      id: data.type === "run" ? data.id : 0,
      text: `${formatError(error)}\n`,
    });
    if (data.type === "run") {
      self.postMessage({ type: "done", id: data.id });
    }
  }
};
