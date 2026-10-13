import type { Writable } from "node:stream";

type DiagnosticWriter = (message: string) => void;
const writers = new WeakMap<Writable, DiagnosticWriter>();

function createDiagnosticWriter(output: Writable): DiagnosticWriter {
  let closed = false;
  const handleError = (error: unknown) => {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    if (
      code !== "EPIPE" &&
      code !== "ERR_STREAM_DESTROYED" &&
      code !== "ERR_STREAM_WRITE_AFTER_END"
    ) {
      throw error;
    }
    closed = true;
  };

  // A dev launcher can exit while Electron and its workspace service are still
  // running. Keep listening for asynchronous write errors for the stream's
  // lifetime, including errors from writes queued before its pipe closed.
  output.on("error", handleError);
  output.once("close", () => {
    closed = true;
  });

  return (message) => {
    if (closed || output.destroyed || output.writableEnded || !output.writable)
      return;
    try {
      output.write(message);
    } catch (error) {
      handleError(error);
    }
  };
}

/** Best-effort diagnostics must not stop a workspace when its log reader exits. */
export function writeDiagnostic(
  message: string,
  output: Writable = process.stderr,
): void {
  let write = writers.get(output);
  if (!write) {
    write = createDiagnosticWriter(output);
    writers.set(output, write);
  }
  write(message);
}
