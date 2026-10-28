import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DisplayWorkspaceService} from "./index.js";
import {configureDisplayBuildRuntime, configureDisplayPluginCatalog, loadDisplayAuthoringCatalog} from "../display-build/index.js";
import type {DisplayDocument} from "../../../display/src/types.js";

let directory: string;
let workspace: DisplayWorkspaceService;
afterEach(async () => {await workspace?.stop(); configureDisplayBuildRuntime(undefined); configureDisplayPluginCatalog(undefined); if (directory) await rm(directory, {recursive: true, force: true});});

test("workspace projects durable output only for its authenticated owner and exposes installed capabilities", async () => {
 directory = await mkdtemp(join(tmpdir(), "display-workspace-test-"));
 let finish: ((value: unknown) => void) | undefined;
 workspace = new DisplayWorkspaceService({directory, ownerUserId: "owner", builders: [{kind: "general:text", version: 1, build: async () => new Promise(resolve => {finish = resolve;})}]});
 await workspace.start();
 expect((await loadDisplayAuthoringCatalog()).some(plugin => plugin.id === "org.xuelearn.display.math")).toBe(true);
 const run = await workspace.builds.enqueue({ownerUserId: "owner", scopeKey: "unit/section/revision", kind: "general:text", componentVersion: 1, input: {text: "Accepted"}});
 const source: DisplayDocument = {version: 1, id: "pending", plugins: [{id: "org.xuelearn.display.general", version: "1.0.0"}], root: {id: "text", kind: "general:text", version: 1, payload: {}, build: {jobId: run.id, status: "pending", sourceHash: run.sourceHash, revision: run.inputRevision}}};
 expect((await workspace.resolveDocument("owner", source)).root.build?.status).toMatch(/pending|running/);
 expect(await workspace.getJob("other", run.id)).toBeNull();
 expect((await workspace.resolveDocument("other", source)).root.build?.status).toBe("failed");
 for (let i = 0; i < 100 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 10));
 expect(finish).toBeDefined();
 finish!({text: "Accepted"});
 for (let i = 0; i < 100 && (await workspace.getJob("owner", run.id))?.status !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 10));
 expect((await workspace.resolveDocument("owner", source)).root).toMatchObject({payload: {text: "Accepted"}, build: {status: "ready"}});
 expect(await workspace.backgroundTaskCount()).toBe(0);
 expect(await workspace.getJob("owner", run.id)).not.toHaveProperty("input");
 const stale = {...source, root: {...source.root, build: {...source.root.build!, sourceHash: "changed"}}};
 expect((await workspace.resolveDocument("owner", stale)).root.build?.status).toBe("failed");
});
