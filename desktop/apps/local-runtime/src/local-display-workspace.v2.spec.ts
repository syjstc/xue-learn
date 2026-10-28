import "reflect-metadata";
import {Module} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {mkdtemp, rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {DisplayWorkspaceService} from "@xue-learn/core/server/display-workspace";
import type {DisplayDocument} from "@xue-learn/core/display/runtime";
import {LOCAL_OWNER_ID} from "@xue-learn/core/runtime-contracts";
import {LocalDisplayWorkspaceController, LOCAL_DISPLAY_WORKSPACE} from "./local-display-workspace.controller.ts";
import {createLocalIngressMiddleware} from "./local-ingress.ts";

it("authenticates plugin installation and build projection through the actual local HTTP controller", async () => {
 const directory = await mkdtemp(join(tmpdir(), "desktop-display-http-"));
 const workspace = new DisplayWorkspaceService({directory, ownerUserId: LOCAL_OWNER_ID, builders: [{kind: "general:text", version: 1, build: async () => ({text: "Built"})}]});
 class TestModule {}
 Module({controllers: [LocalDisplayWorkspaceController], providers: [{provide: LOCAL_DISPLAY_WORKSPACE, useValue: workspace}]})(TestModule);
 const app = await NestFactory.create(TestModule, {logger: false});
 app.use(createLocalIngressMiddleware("test-display-session"));
 try {
  await app.listen(0, "127.0.0.1");
  const base = await app.getUrl();
  const call = (path: string, body?: unknown, authenticated = true) => fetch(base + "/api/local/" + path, {method: body === undefined ? "GET" : "POST", headers: {"content-type": "application/json", ...(authenticated ? {authorization: "Bearer test-display-session"} : {}), "x-user-id": "forged"}, body: body === undefined ? undefined : JSON.stringify(body)});
  expect((await call("display-plugins", undefined, false)).status).toBe(401);
  const manifest = {apiVersion: 1, id: "teacher.http", version: "1.0.0", execution: "declarative", dependencies: [{id: "org.xuelearn.display.general", version: "1.0.0"}], components: [{kind: "teacher:note", version: 1, composition: {id: "text", kind: "general:text", version: 1, payload: {text: "Imported"}}}]};
  expect((await call("display-plugins/import", manifest)).status).toBe(201);
  const installed = await (await call("display-plugins")).json();
  expect(installed).toEqual(expect.arrayContaining([expect.objectContaining({manifest: expect.objectContaining({id: "teacher.http"})})]));
  expect((await call("display-plugins/import", {...manifest, description: "Changed same version"})).status).toBe(400);
  const run = await workspace.builds.enqueue({ownerUserId: LOCAL_OWNER_ID, scopeKey: "source", kind: "general:text", componentVersion: 1, input: {text: "Built"}});
  for (let i = 0; i < 100 && (await workspace.getJob(LOCAL_OWNER_ID, run.id))?.status !== "ready"; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const document = {version: 1, id: "course", plugins: [{id: "org.xuelearn.display.general", version: "1.0.0"}], root: {id: "note", kind: "general:text", version: 1, payload: {}, build: {jobId: run.id, status: "pending", sourceHash: run.sourceHash, revision: run.inputRevision}}};
  const resolved = await (await call("display-builds/resolve", {document})).json() as DisplayDocument;
  expect(resolved.root).toMatchObject({payload: {text: "Built"}, build: {status: "ready"}});
  const privateRun = await workspace.builds.enqueue({ownerUserId: "different-owner", scopeKey: "private", kind: "general:text", componentVersion: 1, input: {text: "Private"}});
  expect((await call(`display-builds/${privateRun.id}`)).status).toBe(404);
  expect((await call(`display-builds/${privateRun.id}/retry`, {})).status).toBe(404);
 } finally {await app.close(); await rm(directory, {recursive: true, force: true});}
}, 20000);
