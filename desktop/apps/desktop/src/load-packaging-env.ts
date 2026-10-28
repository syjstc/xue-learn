import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

/** Load optional signing settings without replacing the launch environment. */
export function loadPackagingEnv({ cwd }: { cwd: string }) {
  const candidates = [
    resolve(cwd, ".env.packaging"),
    resolve(cwd, "../..", ".env.packaging"),
  ];
  const path = candidates.find((candidate) => existsSync(candidate));
  if (!path) return { loaded: false, path: candidates[0] };

  const settings = parseEnv(readFileSync(path, "utf8"));
  for (const [key, value] of Object.entries(settings)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return { loaded: true, path };
}
