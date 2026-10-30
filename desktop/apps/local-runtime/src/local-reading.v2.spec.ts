import "reflect-metadata";
import {Module} from "@nestjs/common";
import {NestFactory} from "@nestjs/core";
import {LOCAL_OWNER_ID} from "@xue-learn/core/runtime-contracts";
import {LocalReadingController, LOCAL_READING_WORKSPACE} from "./local-reading.controller.ts";
import {createLocalIngressMiddleware} from "./local-ingress.ts";

it("protects reading generation, job control and PDF through the local HTTP boundary", async () => {
  const document = {version: 1, title: "教材", blocks: [{id: "b1", type: "paragraph", text: "内容"}]};
  const unsubscribe = jest.fn();
  const reading = {
    read: jest.fn(async (owner, unit) => owner === LOCAL_OWNER_ID && unit === "owned"
      ? {language: "zh-Hans", sections: [{id: "chapter", reading: {document}}]} : null),
    generate: jest.fn(async (owner, unit, section) => ({owner, unit, section})),
    control: jest.fn(async (owner, unit, section, command) => ({owner, unit, section, ...command})),
    subscribe: jest.fn(() => unsubscribe),
  };
  class TestModule {}
  Module({controllers: [LocalReadingController], providers: [{provide: LOCAL_READING_WORKSPACE, useValue: reading}]})(TestModule);
  const app = await NestFactory.create(TestModule, {logger: false});
  app.use(createLocalIngressMiddleware("reading-session"));
  try {
    await app.listen(0, "127.0.0.1");
    const base = await app.getUrl();
    const call = (path: string, body?: unknown, authenticated = true) => fetch(base + "/api/units/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {"content-type": "application/json", ...(authenticated ? {authorization: "Bearer reading-session"} : {}), "x-user-id": "forged"},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect((await call("owned/reading", undefined, false)).status).toBe(401);
    expect((await call("other/reading")).status).toBe(404);
    expect((await call("owned/reading")).status).toBe(200);
    expect(reading.read).toHaveBeenLastCalledWith(LOCAL_OWNER_ID, "owned");
    expect((await call("owned/reading/events", undefined, false)).status).toBe(401);
    expect((await call("other/reading/events")).status).toBe(404);
    const stream = await call("owned/reading/events");
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    expect(await stream.text()).toContain('"text":"内容"');
    expect(reading.subscribe).toHaveBeenCalledWith(LOCAL_OWNER_ID, "owned", expect.any(Function));
    expect(unsubscribe).toHaveBeenCalled();
    expect((await call("owned/reading/sections/chapter/generate", {regenerate: true})).status).toBe(201);
    expect(reading.generate).toHaveBeenLastCalledWith(LOCAL_OWNER_ID, "owned", "chapter", true);
    expect((await call("owned/reading/sections/chapter/generate", {forceDisplay: true})).status).toBe(400);
    expect((await call("owned/reading/sections/chapter/jobs", {jobId: "../bad", action: "retry"})).status).toBe(400);
    expect((await call("owned/reading/sections/chapter/jobs", {jobId: "a".repeat(64), action: "retry", componentId: "b2"})).status).toBe(201);
    expect(reading.control).toHaveBeenLastCalledWith(LOCAL_OWNER_ID, "owned", "chapter", expect.objectContaining({componentId: "b2"}));
    expect((await call("other/reading/sections/chapter/print?layout=mobile")).status).toBe(404);
    expect((await call("owned/reading/sections/chapter/print?layout=bad")).status).toBe(400);
    const pdf = await call("owned/reading/sections/chapter/print?layout=mobile");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toContain("text/html");
    expect(pdf.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect((await pdf.text()).includes("内容")).toBe(true);
  } finally {await app.close();}
});
