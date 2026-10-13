import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { utilityProcess } from "electron";
import { ElectronSidecarProcess } from "./electron-process.ts";

jest.mock("electron", () => ({ utilityProcess: { fork: jest.fn() } }));

describe("Electron sidecar diagnostics", () => {
  const originalDev = process.env.XUELEARN_DESKTOP_DEV;
  const originalE2e = process.env.XUELEARN_DESKTOP_E2E_LOG_SIDECAR;
  let output: PassThrough;

  beforeEach(() => {
    output = new PassThrough();
    jest
      .spyOn(process, "stderr", "get")
      .mockReturnValue(output as unknown as typeof process.stderr);
  });

  afterEach(() => {
    if (originalDev === undefined) delete process.env.XUELEARN_DESKTOP_DEV;
    else process.env.XUELEARN_DESKTOP_DEV = originalDev;
    if (originalE2e === undefined)
      delete process.env.XUELEARN_DESKTOP_E2E_LOG_SIDECAR;
    else process.env.XUELEARN_DESKTOP_E2E_LOG_SIDECAR = originalE2e;
    jest.restoreAllMocks();
    output.destroy();
  });

  function childProcess() {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    });
    (utilityProcess.fork as jest.Mock).mockReturnValue(child);
    return child;
  }

  it("forwards redacted output and native failures through the diagnostic writer", () => {
    process.env.XUELEARN_DESKTOP_DEV = "1";
    const child = childProcess();
    const write = jest.spyOn(output, "write");
    new ElectronSidecarProcess("/app/sidecar.cjs");
    child.stdout.write("Bearer provider-secret\n");
    child.stderr.write(`${"a".repeat(64)}\n`);
    child.emit("error", "crashed", "Bearer provider-secret");
    expect(write.mock.calls.map(([message]) => message)).toEqual([
      "[sidecar] Bearer [redacted]\n",
      "[sidecar-error] [redacted]\n",
      "[sidecar-error] crashed at Bearer [redacted]\n",
    ]);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("keeps both pipes draining when the parent log reader has exited", () => {
    process.env.XUELEARN_DESKTOP_DEV = "1";
    const child = childProcess();
    const write = jest.spyOn(output, "write").mockImplementation(() => {
      throw Object.assign(new Error("write EPIPE"), { code: "EPIPE" });
    });
    new ElectronSidecarProcess("/app/sidecar.cjs");
    expect(() => {
      child.stdout.write("first\n");
      for (let i = 0; i < 20; i += 1) {
        child.stdout.write("still running\n");
        child.stderr.write("still running\n");
      }
      child.emit("error", "crashed", "somewhere");
    }).not.toThrow();
    expect(write).toHaveBeenCalledTimes(1);
    expect(child.stdout.readableLength).toBe(0);
    expect(child.stderr.readableLength).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });

  it("drains product output without logging provider data", async () => {
    delete process.env.XUELEARN_DESKTOP_DEV;
    delete process.env.XUELEARN_DESKTOP_E2E_LOG_SIDECAR;
    const child = childProcess();
    const write = jest.spyOn(output, "write");
    new ElectronSidecarProcess("/app/sidecar.cjs");
    child.stdout.write("private diagnostics\n");
    child.stderr.write("private diagnostics\n");
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(write).not.toHaveBeenCalled();
    expect(child.stdout.readableLength).toBe(0);
    expect(child.stderr.readableLength).toBe(0);
    child.stdout.destroy();
    child.stderr.destroy();
  });
});
