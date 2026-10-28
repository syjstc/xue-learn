import {mkdtemp, readdir, readFile, writeFile, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DisplayPluginStore} from "./index.js";
import type {DisplayPluginManifest} from "../../../display/src/types.js";

const manifest: DisplayPluginManifest = {
  apiVersion: 1, id: "teacher.acoustics", version: "1.0.0", execution: "declarative", title: "声学与音程",
  dependencies: [{id: "org.xuelearn.display.general", version: "1.0.0"}],
  components: [{kind: "teacher:frequency", version: 1, payloadSchema: {type: "object", required: ["title"], properties: {title: {type: "string"}}},
    composition: {id: "label", kind: "general:text", version: 1, payload: {text: {$display: "payload", path: "title"}}}}],
};
let directory: string;
beforeEach(async () => {directory = await mkdtemp(join(tmpdir(), "display-plugins-test-"));});
afterEach(async () => {await rm(directory, {recursive: true, force: true});});

test("published manifests survive reopening and export/reimport without changing integrity", async () => {
  const first = await new DisplayPluginStore(directory).install(manifest);
  const second = new DisplayPluginStore(directory);
  expect((await second.list())[0].manifest.integrity).toBe(`sha256-${first.sha256}`);
  expect((await second.install(first.manifest)).sha256).toBe(first.sha256);
  expect((await readdir(directory)).length).toBe(1);
});
test("concurrent imports converge; changed bytes cannot reuse a published version", async () => {
  const stores = [new DisplayPluginStore(directory), new DisplayPluginStore(directory)];
  const result = await Promise.all(stores.map(store => store.install(manifest)));
  expect(result[0].sha256).toBe(result[1].sha256);
  await expect(stores[0].install({...manifest, title: "changed"})).rejects.toThrow("immutable");
  expect((await stores[1].list())[0].manifest.title).toBe(manifest.title);
});
test("disabled packages leave the generation catalog but remain available for pinned courses", async () => {
  const store = new DisplayPluginStore(directory);
  await store.install(manifest);
  await store.setEnabled(manifest.id, manifest.version, false);
  expect(await store.manifests({forGeneration: true})).toEqual([]);
  expect((await store.manifests())[0].id).toBe(manifest.id);
  await store.setEnabled(manifest.id, manifest.version, true);
  expect((await store.manifests({forGeneration: true})).length).toBe(1);
});
test("public imports cannot install code, replace builtin packages or alter saved content", async () => {
  const builtin = {...manifest, id: "org.xuelearn.display.general", execution: "trusted" as const};
  const store = new DisplayPluginStore(directory, [builtin]);
  await expect(store.install({...manifest, execution: "trusted"})).rejects.toThrow("declarative");
  await expect(store.install({...manifest, id: builtin.id})).rejects.toThrow("built-in");
  await store.install(manifest);
  const filename = (await readdir(directory)).find(name => name.endsWith(".json"))!;
  const saved = JSON.parse(await readFile(join(directory, filename), "utf8"));
  saved.manifest.title = "tampered";
  await writeFile(join(directory, filename), JSON.stringify(saved));
  await expect(store.list()).rejects.toThrow("integrity");
});
