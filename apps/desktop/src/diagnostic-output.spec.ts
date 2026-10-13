import { Writable } from "node:stream";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "esbuild";
import { writeDiagnostic } from "./diagnostic-output.ts";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));
const pipeError = () =>
  Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

describe("diagnostic output", () => {
  it("preserves diagnostic text and shares one error listener across callers", () => {
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(String(chunk));
        done();
      },
    });
    writeDiagnostic("[sidecar] ready\n", output);
    writeDiagnostic("[sidecar-health] ready\n", output);
    expect(chunks).toEqual(["[sidecar] ready\n", "[sidecar-health] ready\n"]);
    expect(output.listenerCount("error")).toBe(1);
    output.destroy();
  });

  it("handles asynchronous EPIPE and stops writing after the reader disconnects", async () => {
    const output = new Writable({
      autoDestroy: false,
      write(_chunk, _encoding, done) {
        setImmediate(() => done(pipeError()));
      },
    });
    const write = jest.spyOn(output, "write");
    writeDiagnostic("[sidecar] first\n", output);
    await nextTurn();
    writeDiagnostic("[sidecar] next\n", output);
    // Keep the listener alive for delayed errors from any earlier writes.
    expect(() => output.emit("error", pipeError())).not.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
    output.destroy();
  });

  it.each(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"])(
    "handles synchronous %s without retrying the failed stream",
    (code) => {
      const output = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      const write = jest.spyOn(output, "write").mockImplementation(() => {
        throw Object.assign(new Error(code), { code });
      });
      expect(() => writeDiagnostic("first", output)).not.toThrow();
      writeDiagnostic("next", output);
      expect(write).toHaveBeenCalledTimes(1);
      output.destroy();
    },
  );

  it.each(["destroy", "end"] as const)("skips a stream after %s", (action) => {
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const write = jest.spyOn(output, "write");
    output[action]();
    writeDiagnostic("ignored", output);
    expect(write).not.toHaveBeenCalled();
  });

  it("does not hide unrelated synchronous or asynchronous errors", () => {
    const output = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const failure = Object.assign(new Error("unexpected I/O failure"), {
      code: "EIO",
    });
    jest.spyOn(output, "write").mockImplementation(() => {
      throw failure;
    });
    expect(() => writeDiagnostic("first", output)).toThrow(failure);
    expect(() => output.emit("error", failure)).toThrow(failure);
    output.destroy();
  });

  it("survives a real stderr pipe disconnect in a separate process", async () => {
    const { code } = transformSync(
      readFileSync(join(__dirname, "diagnostic-output.ts"), "utf8"),
      {
        loader: "ts",
        format: "cjs",
        target: "node22",
      },
    );
    const child = spawn(
      process.execPath,
      [
        "--input-type=commonjs",
        "-e",
        `${code}
      const log = module.exports.writeDiagnostic;
      process.stdin.once("data", () => {
        log("first log after disconnect\\n");
        setTimeout(() => {
          log("second log after disconnect\\n");
          process.stdout.write("still running");
        }, 20);
      });
    `,
      ],
      { stdio: ["pipe", "pipe", "pipe"], timeout: 4_000 },
    );
    let result = "";
    child.stdout.on("data", (chunk) => {
      result += chunk;
    });
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
      },
    );
    child.stderr.once("close", () => child.stdin.end("reader disconnected"));
    child.stderr.destroy();
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(result).toBe("still running");
  });
});
