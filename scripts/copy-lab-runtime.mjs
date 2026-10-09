import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const source = join(root, "dist", "lab-runtime");
const target = join(root, process.env.LAB_RUNTIME_TARGET ?? "dist-desktop", "lab-runtime");

if (!existsSync(source)) throw new Error(`Lab runtime build is missing: ${source}`);
mkdirSync(target, { recursive: true });
cpSync(source, target, { recursive: true });
