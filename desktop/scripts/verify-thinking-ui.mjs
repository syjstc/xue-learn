import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron } from "playwright";
import { stageElectronResources } from "../apps/desktop/scripts/stage-resources.mjs";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const output = resolve(process.argv[2] ?? "artifacts/thinking-ui");
const temporary = await mkdtemp(join(tmpdir(), "xuelearn-thinking-"));
await mkdir(output, { recursive: true });
await stageElectronResources();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function gate() {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  return { promise, release };
}
const scenarios = new Map(["field", "tagged", "direct"].map(name => [name, {
  name, started: false, reasoning: gate(), answer: gate(), finish: gate(),
}]));
const reasoning = "先核对题目中的已知条件。\n再比较两种解法，找出各自适用的情况。\n检查中间步骤，避免遗漏单位。\n最后选择更清楚的方法来解释。";
const pageErrors = [], logs = [], requests = [];
const report = { status: "running", checks: [] };
let application, page;
async function until(read, check, timeout = 45_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const value = await read();
    if (check(value)) return value;
    await delay(100);
  }
  throw Error("Timed out waiting for the fixture state");
}

const server = createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const part of request) raw += part;
    const input = JSON.parse(raw || "{}");
    if (request.url?.endsWith("/embeddings")) {
      response.writeHead(400, {"Content-Type": "application/json"});
      response.end(JSON.stringify({error: {message: "Fixture uses lexical fallback"}}));
      return;
    }
    const user = [...(input.messages ?? [])].reverse().find(message => message.role === "user");
    const name = JSON.stringify(user?.content).match(/THINKING_UI_(field|tagged|direct)/)?.[1];
    const scenario = scenarios.get(name);
    requests.push({name, stream: input.stream});
    if (!scenario || !input.stream) {
      response.writeHead(400, {"Content-Type": "application/json"});
      response.end(JSON.stringify({error: {message: "Unexpected fixture request"}}));
      return;
    }
    scenario.started = true;
    response.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache"});
    const send = (delta, finish_reason = null, usage) => response.write(`data: ${JSON.stringify({
      id: `thinking-${name}`, object: "chat.completion.chunk", created: 1, model: "thinking-fixture",
      choices: [{index: 0, delta, finish_reason}], ...(usage ? {usage} : {}),
    })}\n\n`);
    send({role: "assistant"});
    await scenario.reasoning.promise;
    if (name === "field") {
      for (const line of reasoning.split("\n")) {send({reasoning_content: `${line}\n`}); await delay(50);}
    } else if (name === "tagged") {
      for (const content of ["<thi", "nk>", reasoning, "</thi", "nk>"]) {send({content}); await delay(50);}
    }
    await scenario.answer.promise;
    send({content: `已收到 ${name}。`});
    await scenario.finish.promise;
    send({content: "可以继续学习。"});
    send({}, "stop", {prompt_tokens: 100, completion_tokens: 80, total_tokens: 180});
    response.end("data: [DONE]\n\n");
  } catch (error) {
    logs.push(String(error));
    response.destroy();
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const modelUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USERPROFILE", "SystemRoot"]
  .filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {XUELEARN_DESKTOP_DATA_PATH: join(temporary, "desktop"), XUELEARN_DESKTOP_E2E_LOG_SIDECAR: "1"});
async function launch() {
  application = await _electron.launch({executablePath: require("electron"), args: [join(root, "apps/desktop")], env, timeout: 60_000});
  application.process().stderr.on("data", chunk => logs.push(String(chunk)));
  page = await application.firstWindow();
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.waitForURL("http://127.0.0.1:*/**", {timeout: 60_000});
  await page.goto(new URL("/local/plugins", page.url()).href);
  await page.waitForSelector("#desktop-plugins-title");
}
async function stop() {
  await application?.evaluate(({app}) => app.exit(0)).catch(() => {});
  await application?.close().catch(() => {});
}
try {
  await launch();
  await page.evaluate(async baseUrl => {
    for (const providerId of ["custom", "custom_embedding"]) {
      await window.xueLearnDesktop.credentials.mutate({action: "set", providerId, values: {apiKey: "thinking-fixture", baseUrl}});
    }
  }, modelUrl);
  await stop();
  await launch();
  const api = (method, path, body) => page.evaluate(async ({method, path, body}) => {
    const result = await fetch(path, {method, headers: {"Content-Type": "application/json"}, body: JSON.stringify(body)});
    if (!result.ok) throw Error(`${result.status}: ${await result.text()}`);
    return result.json();
  }, {method, path, body});
  await api("PATCH", "/api/local/ai-models", {capability: "embedding", providerId: "custom_embedding", model: "thinking-fixture"});
  await api("PATCH", "/api/local/ai-models", {capability: "chat", providerId: "custom", model: "thinking-fixture", customThinkingProtocol: "none"});
  await api("PATCH", "/api/settings/learning-view", {chatAudioEnabled: false});
  await page.locator("#assistant-companion-launcher").click();
  const chat = page.locator("#assistant-companion-surface");
  const input = chat.locator('input[placeholder="输入消息…"]');
  await input.waitFor();
  for (const scenario of scenarios.values()) {
    const {name} = scenario;
    const previousBlocks = await chat.locator("[data-thinking-block]").count();
    await input.fill(`请简单回复这条验收消息 THINKING_UI_${name}`);
    await input.press("Enter");
    await until(() => scenario.started, Boolean);
    assert.equal(await chat.locator("[data-thinking-content]").count(), 0);
    scenario.reasoning.release();
    if (name !== "direct") {
      const preview = chat.locator("[data-thinking-content]").last();
      await preview.waitFor();
      await until(() => preview.textContent(), value => value?.includes("最后选择更清楚的方法来解释。"));
      assert.equal((await preview.textContent()).trim(), reasoning);
      assert(await preview.evaluate(element => element.clientHeight <= 61 && element.scrollHeight > element.clientHeight));
      assert(await preview.evaluate(element => element.scrollTop + element.clientHeight >= element.scrollHeight - 2));
      const block = chat.locator("[data-thinking-block]").last();
      assert.equal(await block.getAttribute("aria-busy"), "true");
      await block.getByRole("button", {name: "展开", exact: true}).click();
      assert(await preview.evaluate(element => element.clientHeight > 61));
      await block.getByRole("button", {name: "收起", exact: true}).click();
      await page.screenshot({path: join(output, `${name}-thinking.png`), fullPage: true});
      report.checks.push(`${name}: provider reasoning reaches the real chat incrementally, is bounded to three lines, follows the tail and expands`);
    } else {
      assert.equal(await chat.locator("[data-thinking-block]").count(), previousBlocks);
      report.checks.push("direct: no invented reasoning or expand control while waiting for an answer");
    }
    scenario.answer.release();
    await chat.getByText(`已收到 ${name}。`, {exact: true}).waitFor();
    assert.equal(await chat.locator("[data-thinking-content]").count(), 0);
    if (name !== "direct") {
      const block = chat.locator("[data-thinking-block]").last();
      assert.equal(await block.getAttribute("aria-busy"), "false");
      await block.getByRole("button", {name: "展开", exact: true}).click();
      assert.equal((await block.locator("[data-thinking-content]").textContent()).trim(), reasoning);
      await block.getByRole("button", {name: "收起", exact: true}).click();
      await page.screenshot({path: join(output, `${name}-answer.png`), fullPage: true});
    }
    scenario.finish.release();
    await chat.getByText(`已收到 ${name}。可以继续学习。`, {exact: true}).waitFor();
    await until(() => input.isEnabled(), Boolean);
    report.checks.push(`${name}: the answer streams separately and clears the thinking state`);
  }
  assert.deepEqual(pageErrors, []);
  report.status = "passed";
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = "failed";
  report.error = error.stack;
  await page?.screenshot({path: join(output, "failure.png"), fullPage: true}).catch(() => {});
  throw error;
} finally {
  for (const scenario of scenarios.values()) for (const key of ["reasoning", "answer", "finish"]) scenario[key].release();
  await stop();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await writeFile(join(output, "verification.json"), JSON.stringify({...report, pageErrors, requests}, null, 2));
  await writeFile(join(output, "electron.log"), logs.join(""));
  await rm(temporary, {recursive: true, force: true});
}
