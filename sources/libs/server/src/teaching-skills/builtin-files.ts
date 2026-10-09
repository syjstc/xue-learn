import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export function builtinRoot(): string {
  const configured = process.env.XUELEARN_TEACHING_SKILLS_BUILTIN_ROOT?.trim();
  const candidates = [
    configured,
    // Source/Jest execution, where __dirname is this package directory.
    join(__dirname, "builtin"),
    // The Electron sidecar bundle stages non-code skill assets beside main.js.
    join(__dirname, "teaching-skills", "builtin"),
    // Workspace service execution (including dist builds launched from the repo).
    join(process.cwd(), "libs/server/src/teaching-skills/builtin"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (resolved) return resolved;
  throw new Error(
    `Teaching skill built-ins are unavailable; checked: ${candidates.join(", ")}`,
  );
}

export async function readPackageDirectory(directory: string) {
  const files: Record<string, string> = {};
  files["SKILL.md"] = await readFile(join(directory, "SKILL.md"), "utf8");
  files["xuelearn.json"] = await readFile(
    join(directory, "xuelearn.json"),
    "utf8",
  );
  try {
    const names = await readdir(join(directory, "references"));
    for (const name of names) {
      files[`references/${name}`] = await readFile(
        join(directory, "references", name),
        "utf8",
      );
    }
  } catch {
    // References are optional.
  }
  return files;
}
