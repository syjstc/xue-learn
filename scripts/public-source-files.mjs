import { execFileSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Include current tracked files and unignored additions, never local profiles/output. */
export async function publicSourceFiles() {
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: repositoryRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
  }).split("\0").filter(Boolean);
  const files = [];
  for (const name of new Set(names)) {
    const absolute = path.join(repositoryRoot, name);
    let info;
    try { info = await lstat(absolute); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (info.isSymbolicLink()) {
      const target = await realpath(absolute);
      if (!target.startsWith(repositoryRoot + path.sep))
        throw new Error(`Source symlink escapes the repository: ${name}`);
    }
    if (info.isFile() || info.isSymbolicLink()) files.push(name);
  }
  return files.sort();
}
