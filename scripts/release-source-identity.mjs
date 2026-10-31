import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { publicSourceFiles, repositoryRoot } from "./public-source-files.mjs";

export async function releaseSourceIdentity() {
  const digest = createHash("sha256");
  for (const file of await publicSourceFiles()) {
    digest.update(file).update("\0").update(createHash("sha256")
      .update(await readFile(path.join(repositoryRoot, file))).digest()).update("\0");
  }
  const git = args => execFileSync("git", args, { cwd: repositoryRoot, encoding: "utf8" }).trim();
  return {
    sourceCommit: git(["rev-parse", "HEAD"]),
    sourceTreeSha256: digest.digest("hex"),
    sourceDirty: Boolean(git(["status", "--porcelain", "--untracked-files=normal"])),
  };
}

export function assertReleaseSourceIdentity(built, current) {
  if (built.sourceDirty !== false || current.sourceDirty !== false)
    throw Error("Release export requires a clean committed source tree.");
  if (built.sourceCommit !== current.sourceCommit || built.sourceTreeSha256 !== current.sourceTreeSha256)
    throw Error("The application was built from different source; rebuild before exporting.");
}
