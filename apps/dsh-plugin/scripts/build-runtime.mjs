import {spawnSync} from "node:child_process";
import {copyFileSync, mkdirSync, renameSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve, dirname} from "node:path";
import {stageRuntimeResources} from "./runtime-resources.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktop = resolve(root, "../../desktop");
const output = resolve(root, "dist");
mkdirSync(output, {recursive: true});
const result = spawnSync(process.execPath, ["scripts/build-service.mjs", "local-runtime", "--production"], {
  cwd: desktop, stdio: "inherit", env: {...process.env,
    XUELEARN_LOCAL_RUNTIME_ENTRY: resolve(root, "runtime/worker.ts"),
    XUELEARN_LOCAL_RUNTIME_BUILD_DIR: output,
  },
});
if (result.status !== 0) process.exit(result.status ?? 1);
renameSync(resolve(output, "main.js"), resolve(output, "runtime-worker.cjs"));
writeFileSync(resolve(output, "package.json"), JSON.stringify({type: "commonjs"}));
copyFileSync(resolve(root, "../../core/THIRD_PARTY_NOTICES.md"), resolve(output, "CORE_THIRD_PARTY_NOTICES.md"));
copyFileSync(resolve(desktop, "THIRD_PARTY_NOTICES.md"), resolve(output, "DESKTOP_THIRD_PARTY_NOTICES.md"));
stageRuntimeResources({coreRoot: resolve(root, "../../core"), output});
