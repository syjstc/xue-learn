import express from "express";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server } from "node:http";
import { rendererShell } from "./renderer-shell";

describe("packaged renderer shell", () => {
  let directory: string, server: Server, origin: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "xuelearn-shell-"));
    const root = join(directory, ".hidden-parent", "desktop-renderer");
    await mkdir(root, { recursive: true });
    await writeFile(join(root, "index.html"), "<!doctype html><main>Desktop shell</main>");
    const app = express();
    app.use(rendererShell(root, true));
    app.use((_req, res) => res.status(404).json({ error: "API_NOT_FOUND" }));
    server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  it("opens the homepage and nested app routes even inside hidden directories", async () => {
    for (const route of ["/", "/local/api-keys", "/goals/example"]) {
      const result = await fetch(origin + route);
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
      expect(await result.text()).toContain("Desktop shell");
    }
  });
  it("preserves API 404s and never returns the shell for mutations", async () => {
    for (const route of ["/api", "/api/not-found"]) {
      const result = await fetch(origin + route);
      expect(result.status).toBe(404);
      expect(await result.json()).toEqual({ error: "API_NOT_FOUND" });
    }
    expect((await fetch(origin + "/", { method: "POST" })).status).toBe(404);
  });
});
