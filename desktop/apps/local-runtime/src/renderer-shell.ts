import { resolve } from "node:path";
import type { RequestHandler } from "express";

/** Serve the fixed BrowserRouter shell relative to its resource root. An
 * absolute sendFile path also treats hidden parent directories as dotfiles. */
export function rendererShell(rendererPath: string, disableCache = false): RequestHandler {
  const root = resolve(rendererPath);
  return (request, response, next) => {
    if (request.method !== "GET" || request.path === "/api" || request.path.startsWith("/api/")) {
      next();
      return;
    }
    if (disableCache) response.setHeader("Cache-Control", "no-store");
    response.sendFile("index.html", { root });
  };
}
