import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {createServer} from "node:http";
import {execFileSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, readdir, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";
import {_electron} from "playwright";
import {stageElectronResources} from "../apps/desktop/scripts/stage-resources.mjs";

const root = resolve(import.meta.dirname, ".."), require = createRequire(import.meta.url);
const output = resolve(process.argv[2] ?? "artifacts/reading-ui");
const flowOnly = process.argv.includes("--flow-only");
const fixture = JSON.parse(await readFile(join(root, "scripts/fixtures/reading-chapter.json"), "utf8"));
const temporary = await mkdtemp(join(tmpdir(), "xuelearn-reading-ui-"));
await mkdir(output, {recursive: true});
// Direct Electron launches do not run Forge's preStart hook. Always verify the
// rebuilt service, rather than silently exercising a previous staged version.
await stageElectronResources();
let releaseComponents;
const componentGate = new Promise(resolve => {releaseComponents = resolve;});
let releaseFirstParagraph, releaseDocumentTail;
const firstParagraphGate = new Promise(resolve => {releaseFirstParagraph = resolve;});
const documentTailGate = new Promise(resolve => {releaseDocumentTail = resolve;});
if (flowOnly) {releaseFirstParagraph(); releaseDocumentTail(); releaseComponents();}
let failSvg = true, application, page;
const requests = [], pageErrors = [], logs = [], apiErrors = [];
let readingStreams = 0, readingFollowUpCreations = 0;
const report = {status: "running", scope: "Real Electron host and local service, disposable SQLite workspace, deterministic local model responses; no user courses or paid model calls.", checks: []};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, check, timeout = 45_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    try {value = await read(); if (check(value)) return value;} catch {}
    await delay(200);
  }
  throw Error(`Timed out: ${JSON.stringify(value)?.slice(0, 1200)}`);
}

// Exercise the production model transport and structured parsers, including
// partial publication. Components deliberately wait after the body is finished.
const server = createServer(async (request, response) => {
  try {
    let raw = ""; for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw || "{}");
    const prompt = JSON.stringify(input.messages ?? []);
    const kind = prompt.includes("【阅读正文】") ? "follow-up"
      : prompt.includes("Write an accurate, self-contained interactive textbook chapter") ? "document"
      : prompt.includes("Return actual function expressions") ? "plot"
      : prompt.includes("Write one complete ordered derivation") ? "derivation"
      : prompt.includes("Return a complete self-contained SVG") ? "svg" : "other";
    requests.push({kind, stream: input.stream, tool: input.tools?.[0]?.function?.name, time: Date.now(),
      ...(kind === "follow-up" ? {readingQuote: prompt.includes(fixture.blocks[0].text), displayQuote: prompt.includes("原有内容保持完整")} : {})});
    if (kind !== "document" && kind !== "follow-up") await componentGate;
    if (response.destroyed) return;
    if (kind === "other" || kind === "svg" && failSvg) {
      response.writeHead(400, {"Content-Type": "application/json"});
      response.end(JSON.stringify({error: {message: "Synthetic component failure", type: "invalid_request_error"}}));
      return;
    }
    const tool = kind === "follow-up" ? undefined : input.tools?.[0]?.function;
    const schema = tool?.parameters ?? input.response_format?.json_schema?.schema;
    // Replay the observed provider aliases rather than only ideal schema output.
    const wireBlocks = fixture.blocks.map((block, index) => index === 0
      ? {type: "prose", content: block.text} : block);
    if (kind === "document") {
      assert(prompt.includes("Block JSON Schema:"), "Reading request must include the block schema");
      assert(prompt.includes("componentType"), "Slot componentType must be supplied to the model");
      assert(prompt.includes("concept_grid"), "Rich reading blocks must be supplied to the model");
    }
    const data = kind === "document"
      ? schema?.properties?.items ? {items: wireBlocks} : wireBlocks
      : fixture[kind];
    const content = kind === "follow-up" ? "这是针对阅读正文的追问回答：等式两边同时减去相同的数，等式仍然成立。" : JSON.stringify(data);
    if (!input.stream) {
      response.writeHead(200, {"Content-Type": "application/json"});
      response.end(JSON.stringify({id: "fixture", object: "chat.completion", model: "reading-fixture",
        choices: [{index: 0, message: tool ? {role: "assistant", content: null,
          tool_calls: [{id: "call_fixture", type: "function", function: {name: tool.name, arguments: content}}]}
          : {role: "assistant", content}, finish_reason: tool ? "tool_calls" : "stop"}],
        usage: {prompt_tokens: 100, completion_tokens: 200, total_tokens: 300}}));
      return;
    }
    response.writeHead(200, {"Content-Type": "text/event-stream", "Cache-Control": "no-cache"});
    const send = (delta, finish = null, usage) => response.write(`data: ${JSON.stringify({
      id: "fixture", object: "chat.completion.chunk", created: 1, model: "reading-fixture",
      choices: [{index: 0, delta, finish_reason: finish}], ...(usage ? {usage} : {}),
    })}\n\n`);
    send({role: "assistant", ...(tool ? {tool_calls: [{index: 0, id: "call_fixture", type: "function",
      function: {name: tool.name, arguments: ""}}]} : {})});
    const firstDocument = kind === "document" && requests.filter(item => item.kind === "document").length === 1;
    // Stop exactly at the first closing brace: no lookahead or end-of-response
    // flush may be required before the first readable block reaches the UI.
    const firstBoundary = firstDocument ? 1 + JSON.stringify(wireBlocks[0]).length : -1;
    const tailBoundary = firstDocument ? content.indexOf(JSON.stringify(fixture.blocks.at(-1))) + 24 : -1;
    for (let offset = 0; offset < content.length && !response.destroyed;) {
      if (offset === firstBoundary) await firstParagraphGate;
      if (offset === tailBoundary) await documentTailGate;
      const next = Math.min(offset + 240, content.length,
        ...[firstBoundary, tailBoundary].filter(boundary => boundary > offset));
      const part = content.slice(offset, next);
      send(tool ? {tool_calls: [{index: 0, function: {arguments: part}}]} : {content: part});
      offset = next;
      if (kind === "document") await delay(130);
    }
    send({}, tool ? "tool_calls" : "stop", {prompt_tokens: 100, completion_tokens: 200, total_tokens: 300});
    response.end("data: [DONE]\n\n");
  } catch (error) {
    requests.push({kind: "fixture-error", error: String(error)});
    console.error("Fixture error:", error);
    if (!response.destroyed) {response.writeHead(500); response.end(String(error));}
  }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const modelUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = Object.fromEntries(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USERPROFILE", "SystemRoot"].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, {XUELEARN_DESKTOP_DATA_PATH: join(temporary, "desktop"), XUELEARN_DESKTOP_E2E_LOG_SIDECAR: "1"});
async function launch() {
  application = await _electron.launch({executablePath: require("electron"), args: [join(root, "apps/desktop")], env, timeout: 60_000});
  application.process().stderr.on("data", chunk => logs.push(String(chunk)));
  page = await application.firstWindow();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => {
    if (request.url().endsWith("/api/agent/threads") && request.method() === "POST" &&
        request.postDataJSON()?.conversationContext?.anchor?.reading) readingFollowUpCreations++;
  });
  page.on("response", response => {
    if (response.status() >= 400 && response.url().includes("/reading")) apiErrors.push({url: response.url(), status: response.status()});
    if (response.status() === 200 && response.url().endsWith("/reading/events")) readingStreams++;
  });
  await page.waitForURL("http://127.0.0.1:*/**", {timeout: 60_000});
  await page.goto(new URL("/local/plugins", page.url()).href);
  await page.waitForSelector("#desktop-plugins-title");
}
try {
  await launch();
  const workspace = (await page.evaluate(() => window.xueLearnDesktop.workspaces.list())).find(item => item.active);
  assert(workspace);
  const database = join(temporary, "desktop/workspaces", workspace.workspaceId, "xuelearn-local-v2.sqlite3");
  const seed = String.raw`import sqlite3,sys,datetime,json
db=sqlite3.connect(sys.argv[1]);now=datetime.datetime.now(datetime.timezone.utc).isoformat()
def insert(table,values):
 if table=='LearningUnit':values['curriculumKey']=values['id']
 for _,name,type_,required,default,pk in db.execute('PRAGMA table_info("'+table+'")'):
  if name in values or not required or default is not None:continue
  values[name]=now if name.endswith('At') else 0 if any(n in type_.upper() for n in ['INT','REAL','BOOL']) else ''
 names=list(values);db.execute('INSERT INTO "'+table+'" ('+','.join('"'+x+'"' for x in names)+') VALUES ('+','.join('?' for _ in names)+')',[values[x] for x in names])
insert('LearningGoal',dict(id='reading-goal',userId='local-owner-v1',title='阅读与演示独立验收',goalKind='micro',contentLanguage='zh-Hans',status='active'))
insert('LearningUnit',dict(id='reading-unit',goalId='reading-goal',moduleId=None,title='一次方程与函数图像',unitKind='overview',contentSummary='解一次方程，观察直线斜率。',contentRevision=1,orderIndex=0))
for index in range(2):
 section='chapter-'+str(index+1)
 insert('UnitSection',dict(id=section,stableKey=section,unitId='reading-unit',title=['一次方程','函数图像'][index],contentSummary='解一次方程与函数图像。',orderIndex=index,contentKind='standard',generationStatus='ready',testGenerationStatus='pending',contentRevision=1,assessmentAfter=0))
 insert('UnitSectionMaterial',dict(id='material-'+str(index),sectionId=section,introduction='已保存的原教材正文。',blocks=json.dumps([dict(type='paragraph',text='原有内容保持完整，可以继续阅读。')]),keyTakeaways='[]'))
insert('LearningGoal',dict(id='flow-goal',userId='local-owner-v1',title='共用学习流程验收',goalKind='full',learningMode='exploration',contentLanguage='zh-Hans',status='active'))
insert('LearningUnit',dict(id='flow-unit',goalId='flow-goal',moduleId=None,title='阅读与演示共用预习和习题',unitKind='lesson',contentSummary='理解方程。',contentRevision=1,orderIndex=0))
sq=dict(survey=dict(outline=['等式的性质'],learningTargetLabels=[]),learningTargets=[],questions=[dict(text='为什么等式两边要同时运算？',learningTargetIds=[])])
insert('UnitSessionState',dict(id='flow-session',unitId='flow-unit',currentStep='structured_input',structuredSubStep='sq',sq3rData=json.dumps(sq)))
insert('UnitSection',dict(id='flow-chapter',stableKey='flow-chapter',unitId='flow-unit',title='等式的性质',contentSummary='理解等式两边的运算。',orderIndex=0,contentKind='standard',generationStatus='ready',testGenerationStatus='ready',contentRevision=1,assessmentAfter=1,requiredForCompletion=1))
check=dict(type='check',checkId='flow-check',questionType='mcq',primaryLearningTargetId='lt_1',learningTargetIds=['lt_1'],evidenceDimension='understanding',criterionRef='lt_1:criterion_1',contextDistance='same',question='方程 x + 1 = 3 的解是多少？',options=['x = 1','x = 2'],correctIndex=1,explanation='等式两边同时减 1。')
insert('UnitSectionMaterial',dict(id='flow-material',sectionId='flow-chapter',introduction='等式两边同时进行相同运算。',blocks=json.dumps([dict(type='paragraph',text='两边同时减去同一个数，等式仍成立。'),dict(type='heading',level=2,text='理解检查'),check]),keyTakeaways='[]'))
insert('LearningUnit',dict(id='reading-only-unit',goalId='reading-goal',moduleId=None,title='只有阅读正文的章节',unitKind='overview',contentSummary='只生成阅读即可完成本节。',contentRevision=1,orderIndex=1))
insert('UnitSection',dict(id='reading-only-chapter',stableKey='reading-only-chapter',unitId='reading-only-unit',title='独立正文共用进度',contentSummary='解一次方程。',orderIndex=0,contentKind='standard',generationStatus='pending',testGenerationStatus='pending',contentRevision=1,assessmentAfter=0,requiredForCompletion=1))
db.commit();db.close()`;
  execFileSync("python3", ["-c", seed, database]);
  const original = execFileSync("python3", ["-c", "import sqlite3,sys,json;d=sqlite3.connect(sys.argv[1]);print(json.dumps(d.execute('SELECT * FROM UnitSectionMaterial ORDER BY id').fetchall()))", database], {encoding: "utf8"});
  await page.evaluate(baseUrl => window.xueLearnDesktop.credentials.mutate({action: "set", providerId: "custom",
    values: {apiKey: "reading-fixture-no-secret", baseUrl}}), modelUrl);
  // Bootstrap jobs can defer credential-triggered service restarts. Relaunch
  // this disposable profile with its persisted local fixture provider ready.
  await application.evaluate(({app}) => app.exit(0)).catch(() => {});
  await application.close().catch(() => {});
  await launch();
  await until(() => page.evaluate(async () => (await (await fetch("/api/local/ai-models")).json()).customBaseUrl), value => value === modelUrl, 60_000);
  const api = (method, path, body) => page.evaluate(async ({method, path, body}) => {
    const result = await fetch(path, {method, headers: {"Content-Type": "application/json"}, body: body === undefined ? undefined : JSON.stringify(body)});
    if (!result.ok) throw Error(`${result.status}: ${await result.text()}`);
    return result.json();
  }, {method, path, body});
  const selectReading = async (length = 6) => {
    const paragraph = page.locator('[data-reading-block="b1"] .reading-prose p').first();
    await paragraph.scrollIntoViewIfNeeded();
    await paragraph.evaluate((element, length) => {
      const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode();
      const range = document.createRange(); range.setStart(node, 0); range.setEnd(node, Math.min(length, node.textContent.length));
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    }, length);
    await page.locator("[data-follow-up-toolbar]").waitFor({state: "visible"});
  };
  const askReading = async (unitId, sectionId, documentId, screenshot) => {
    await selectReading();
    await page.screenshot({path: join(output, screenshot.replace(".png", "-selection.png")), fullPage: true});
    const created = page.waitForResponse(response => response.url().endsWith("/api/agent/threads") &&
      response.request().method() === "POST" && Boolean(response.request().postDataJSON()?.conversationContext?.anchor?.reading));
    await page.locator("[data-follow-up-toolbar]").getByRole("button", {name: "追问", exact: true}).click();
    const response = await created;
    assert.equal(response.status(), 201);
    const {threadId} = await response.json();
    const saved = await api("GET", `/api/agent/threads/${threadId}`);
    const context = saved.thread?.conversationContext ?? saved.conversationContext;
    assert.deepEqual(context.anchor.reading, {documentId, blockId: "b1"});
    assert.equal(context.anchor.sectionId, sectionId);
    assert.equal(context.anchor.selectedText, fixture.blocks[0].text.slice(0, 6));
    assert(context.anchorSnippet.includes(fixture.blocks[0].text));
    assert(!context.anchorSnippet.includes("原有内容保持完整"));
    const input = page.getByPlaceholder("输入消息…", {exact: true});
    await input.fill("请解释选中的这段阅读内容");
    await input.press("Enter");
    await page.getByText("这是针对阅读正文的追问回答：等式两边同时减去相同的数，等式仍然成立。", {exact: true}).waitFor({timeout: 60_000});
    const records = await until(() => api("GET", `/api/units/${unitId}/follow-ups`), data =>
      data.threads?.some(thread => thread.id === threadId && thread.messages.length >= 2));
    assert.deepEqual(records.threads.find(thread => thread.id === threadId).anchor.reading, {documentId, blockId: "b1"});
    await page.screenshot({path: join(output, screenshot), fullPage: true});
    await page.getByRole("button", {name: "收起学习助手", exact: true}).click();
    return threadId;
  };
  await api("PATCH", "/api/local/ai-models", {capability: "embedding", providerId: "ollama", model: "reading-fixture"});
  await api("PATCH", "/api/local/ai-models", {capability: "chat", providerId: "custom", model: "reading-fixture", customThinkingProtocol: "none"});
  await api("PATCH", "/api/settings/learning-view", {mode: "reading", chatAudioEnabled: false});
  if (!flowOnly) {
  await page.goto(new URL("/goals/reading-goal/units/reading-unit?view=reading&section=chapter-1", page.url()).href);
  await page.waitForSelector("[data-reading-workspace]");
  await page.getByRole("button", {name: "生成阅读", exact: true}).waitFor();
  assert.equal(await page.locator(".reading-legacy").count(), 0);
  assert(!(await page.locator("[data-reading-workspace]").innerText()).includes("原有内容保持完整"));
  assert(await page.locator(".reading-continue button").isDisabled());
  report.checks.push("the reading empty state excludes saved Display material and cannot complete from Display readiness");
  await page.getByRole("button", {name: "生成阅读", exact: true}).click();
  const read = () => api("GET", "/api/units/reading-unit/reading");
  await page.getByText(fixture.blocks[0].text, {exact: true}).waitFor();
  const prefix = (await read()).sections[0].reading;
  assert.equal(prefix.status, "running");
  assert.equal(prefix.document.blocks.length, 1);
  assert(readingStreams > 0, "The JIT reading event stream must be connected");
  assert(!("legacy" in (await read()).sections[0]));
  await page.screenshot({path: join(output, "jit-first-paragraph.png"), fullPage: true});
  await selectReading(1);
  await page.keyboard.press("Escape");
  await page.locator("[data-follow-up-toolbar]").waitFor({state: "detached"});
  await askReading("reading-unit", "chapter-1", prefix.jobId, "jit-reading-follow-up.png");
  const creationCount = readingFollowUpCreations;
  await selectReading();
  await page.locator("[data-follow-up-toolbar]").getByRole("button", {name: "追问", exact: true}).click();
  await page.getByText("这是针对阅读正文的追问回答：等式两边同时减去相同的数，等式仍然成立。", {exact: true}).waitFor();
  assert.equal(readingFollowUpCreations, creationCount, "Selecting the same quote should reopen its saved conversation");
  await page.getByRole("button", {name: "收起学习助手", exact: true}).click();
  assert.equal((await read()).sections[0].reading.status, "running");
  assert(requests.some(request => request.kind === "follow-up" && request.readingQuote && !request.displayQuote));
  await selectReading();
  await page.getByRole("button", {name: "演示", exact: true}).click();
  await page.locator("[data-follow-up-toolbar]").waitFor({state: "detached"});
  assert(!(await page.locator('[data-course-mode="display"]').innerText()).includes("这是针对阅读正文的追问回答"));
  await page.getByRole("button", {name: "阅读", exact: true}).click();
  assert.equal(await page.locator("[data-follow-up-toolbar]").count(), 0);
  report.checks.push("single-character and phrase selections work on JIT reading; answers use reading context and persist; reselecting a quote reopens its conversation; Escape and mode changes dismiss the toolbar; reading discussions stay out of Display");
  await page.reload();
  await page.getByText(fixture.blocks[0].text, {exact: true}).waitFor();
  assert.equal((await read()).sections[0].reading.status, "running");
  assert.equal(requests.filter(request => request.kind === "document").length, 1);
  releaseFirstParagraph();
  await page.locator(".reading-accordion summary").waitFor();
  await page.locator(".reading-accordion summary").click();
  await page.locator(".reading-options input").first().check();
  await page.locator(".reading-check").evaluate(element => {element.dataset.jitIdentity = "retained";});
  await until(read, course => course.sections[0].reading?.document?.blocks.length === fixture.blocks.length - 1);
  assert.equal((await read()).sections[0].reading.status, "running");
  assert.equal(await page.getByText(fixture.blocks.at(-1).text, {exact: true}).count(), 0);
  releaseDocumentTail();
  const first = await until(read, course => course.sections[0].reading?.status === "ready");
  assert.equal(first.sections[0].reading.pendingComponents, 3);
  assert.equal(await page.locator(".reading-check").getAttribute("data-jit-identity"), "retained");
  assert(await page.locator(".reading-options input").first().isChecked());
  assert.equal(await page.locator(".reading-accordion").getAttribute("open"), "");
  report.checks.push("the observed prose/content alias renders through JIT SSE at the first closing brace while the response is held open; reload restores it and completion preserves live interactions");
  await page.getByText(/即使图示仍在生成/).waitFor();
  await page.screenshot({path: join(output, "body-before-components.png"), fullPage: true});
  report.checks.push("full body is ready while all three component jobs are pending; later paragraphs remain readable");
  await page.getByText("回答正确", {exact: true}).waitFor();
  await page.getByRole("button", {name: "演示", exact: true}).click();
  await page.locator('[data-course-mode="display"]').waitFor({state: "visible"});
  await page.getByRole("button", {name: "阅读", exact: true}).click();
  await page.locator("[data-reading-workspace]").waitFor({state: "visible"});
  assert(await page.locator(".reading-options input").first().isChecked());
  assert.equal(await page.locator(".reading-accordion").getAttribute("open"), "");
  assert.equal(await page.locator("[data-learning-flow]").count(), 1);
  report.checks.push("switching the chapter body preserves the one shared learning flow, expanded explanation and learner answer");
  await page.locator(".reading-continue button").click();
  await page.locator('[data-reading-section="chapter-2"]').waitFor();
  assert.equal(new URL(page.url()).searchParams.get("section"), "chapter-2");
  assert.equal(new URL(page.url()).searchParams.get("readingSection"), null);
  await page.getByRole("button", {name: "生成阅读", exact: true}).click();
  await until(read, course => course.sections[1].reading?.status === "ready");
  report.checks.push("the shared completion action advances both modes to chapter 2 while chapter 1 figures are still pending");
  releaseComponents();
  await until(read, course => course.sections.every(section => section.reading?.pendingComponents === 0), 60_000);
  await page.getByRole("button", {name: "展开学习旅程", exact: true}).filter({visible: true}).click();
  await page.getByRole("button", {name: /第 1 节 · 一次方程/}).filter({visible: true}).click();
  await page.getByRole("button", {name: "收起学习旅程", exact: true}).click();
  await page.getByRole("button", {name: "重试组件", exact: true}).waitFor();
  const bodyCalls = requests.filter(request => request.kind === "document").length;
  failSvg = false;
  await page.getByRole("button", {name: "重试组件", exact: true}).click();
  await until(read, course => course.sections[0].reading.document.blocks[6].component.status === "ready");
  await page.locator(".reading-placeholder").waitFor({state: "detached"});
  assert.equal(requests.filter(request => request.kind === "document").length, bodyCalls);
  report.checks.push("failed SVG retries by itself without another body call");
  const slider = page.locator('[data-reading-workspace] input[type="range"]').first();
  await slider.waitFor();
  const before = await slider.inputValue();
  await slider.focus(); await slider.press("ArrowRight");
  assert.notEqual(await slider.inputValue(), before);
  assert.equal(await page.locator(".reading-premises .katex").count(), 4);
  assert.equal(await page.locator(".reading-premises .katex-error").count(), 0);
  const readingDerivationWidth = await page.locator(".reading-derivation").evaluate(element => element.clientWidth);
  await page.getByRole("button", {name: "演示推导", exact: true}).click();
  const derivationDialog = page.getByRole("dialog");
  await derivationDialog.locator('[data-display-artwork="math:derivation"]').waitFor();
  assert.equal(await derivationDialog.locator(".lp-teaching-givens .katex").count(), 4);
  const derivationStage = derivationDialog.locator(".reading-derivation-stage");
  const step = () => derivationDialog.locator("[data-teaching-step]").getAttribute("data-teaching-step");
  const previous = derivationDialog.getByRole("button", {name: "上一步", exact: true});
  const next = derivationDialog.getByRole("button", {name: "下一步", exact: true});
  const settled = () => derivationStage.getAttribute("data-animating");
  assert.equal(await page.locator(".reading-steps, .reading-premises").count(), 0);
  assert.equal(await derivationDialog.getByRole("slider").count(), 0);
  assert.equal(await derivationDialog.getByRole("button", {name: /播放|暂停/}).count(), 0);
  assert(await derivationStage.evaluate(element => element.clientWidth) > readingDerivationWidth + 80);
  assert.equal(await step(), "1");
  assert(await previous.isDisabled());
  await next.click();
  assert.equal(await step(), "2");
  assert.equal(await settled(), "true");
  assert(await next.isDisabled());
  const middleFrame = await until(() => derivationDialog.locator("[data-display-frame]").getAttribute("data-display-frame"),
    value => Number(value) > 0 && Number(value) < 38.4);
  assert(Number(middleFrame) > 0);
  await derivationDialog.screenshot({path: join(output, "derivation-step-animation.png")});
  await until(settled, value => value === "false");
  const heldFrame = await derivationDialog.locator("[data-display-frame]").getAttribute("data-display-frame");
  await delay(900);
  assert.equal(await step(), "2", "A settled step must wait for the learner");
  assert.equal(await derivationDialog.locator("[data-display-frame]").getAttribute("data-display-frame"), heldFrame);
  await next.click();
  await until(settled, value => value === "false");
  assert.equal(await step(), "3");
  assert(await next.isDisabled());
  await previous.click();
  assert.equal(await step(), "2");
  assert.equal(await settled(), "true");
  await until(settled, value => value === "false");
  await page.keyboard.press("ArrowLeft");
  await until(settled, value => value === "false");
  assert.equal(await step(), "1");
  await page.keyboard.press("ArrowRight");
  await until(settled, value => value === "false");
  assert.equal(await step(), "2");
  await page.screenshot({path: join(output, "shared-derivation-display.png"), fullPage: true});
  await derivationDialog.getByRole("button", {name: "阅读步骤", exact: true}).click();
  await derivationDialog.waitFor({state: "detached"});
  assert.equal(await page.locator(".reading-steps > li").count(), 3);
  await page.getByRole("button", {name: "演示推导", exact: true}).click();
  await derivationDialog.locator('[data-teaching-step="2"]').waitFor();
  await page.keyboard.press("Escape");
  await derivationDialog.waitFor({state: "detached"});
  assert(await page.getByRole("button", {name: "演示推导", exact: true}).evaluate(element => element === document.activeElement));
  report.checks.push("derivation switches out of reading into an enlarged stage; previous/next and arrow keys animate whole steps, hold until clicked, respect first/last boundaries and preserve the cursor on mode switches; no playback or timeline controls");
  assert.equal(await page.locator(".reading-formula .katex-error").count(), 0);
  assert.equal(await page.locator(".reading-formula .katex").count(), 3);
  assert(!(await page.locator(".reading-formula").allTextContents()).some(text => text.includes("$$")));
  await page.locator(".reading-derivation").scrollIntoViewIfNeeded();
  await page.screenshot({path: join(output, "readable-derivation.png"), fullPage: true});
  await page.getByRole("button", {name: "放大查看", exact: true}).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const canvasWidth = await dialog.locator(".reading-figure-canvas").evaluate(element => element.getBoundingClientRect().width);
  await dialog.getByRole("button", {name: "放大图示", exact: true}).click();
  assert(await dialog.locator(".reading-figure-canvas").evaluate(element => element.getBoundingClientRect().width) > canvasWidth);
  await page.screenshot({path: join(output, "expanded-figure.png"), fullPage: true, animations: "disabled"});
  await page.keyboard.press("Escape");
  await dialog.waitFor({state: "detached"});
  assert.equal(await page.locator('.reading-figure-viewport').getAttribute("data-zoomed"), "false");
  report.checks.push("saved dollar-wrapped and double-escaped formulas render as KaTeX; figure expansion, zoom and Escape dismissal work");
  for (const selector of [".reading-method", ".reading-comparison", ".reading-concepts", ".reading-summary"])
    assert.equal(await page.locator(selector).count(), 1);
  assert.equal(await page.locator(".reading-callout[data-variant]").count(), 4);
  await page.locator(".reading-comparison").scrollIntoViewIfNeeded();
  await page.screenshot({path: join(output, "reading-components.png"), fullPage: true});
  report.checks.push("four distinct callout variants, method steps, comparisons, concept cards and a summary render");
  await page.setViewportSize({width: 1280, height: 960});
  await page.locator("[data-workspace-scroll]").evaluate(element => {element.scrollTop = 0;});
  await page.screenshot({path: join(output, "reading-desktop.png"), fullPage: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForFunction(() => getComputedStyle(document.querySelector("[data-workspace-content]")).marginLeft === "0px");
  await page.getByRole("button", {name: "演示推导", exact: true}).click();
  await derivationDialog.locator('[data-teaching-step="2"]').waitFor();
  const phonePresentation = await derivationDialog.evaluate(element => ({width: element.clientWidth, scrollWidth: element.scrollWidth, height: element.clientHeight}));
  assert(phonePresentation.width <= 390 && phonePresentation.scrollWidth <= phonePresentation.width + 1, JSON.stringify(phonePresentation));
  assert(phonePresentation.height <= 844, JSON.stringify(phonePresentation));
  for (const button of [previous, next]) {
    const bounds = await button.boundingBox();
    assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 844, JSON.stringify(bounds));
  }
  await page.screenshot({path: join(output, "derivation-presentation-phone.png"), fullPage: true, animations: "disabled"});
  await page.keyboard.press("Escape");
  await derivationDialog.waitFor({state: "detached"});
  await page.locator("[data-workspace-scroll]").evaluate(element => {element.scrollTop = 0;});
  assert.equal(await page.evaluate(() => window.innerWidth), 390);
  await page.screenshot({path: join(output, "reading-phone.png"), fullPage: true});
  const overflow = await page.locator(".reading-paper").evaluate(element => ({client: element.clientWidth, scroll: element.scrollWidth}));
  assert(overflow.client >= 340, JSON.stringify(overflow));
  assert(overflow.scroll <= overflow.client + 2, JSON.stringify(overflow));
  const fontSize = await page.locator(".reading-block .reading-prose p").first().evaluate(element => Number.parseFloat(getComputedStyle(element).fontSize));
  assert(fontSize >= 17, `Phone prose is too small: ${fontSize}px`);
  report.checks.push("390px reading article has no horizontal overflow");
  const printHtml = await page.evaluate(async () => (await fetch("/api/units/reading-unit/reading/sections/chapter-1/print?layout=mobile")).text());
  for (const text of ["解方程的三个动作", "方程与函数，关注点有何不同？", "两个容易混淆的概念", "读完后，记住这三点", "从方程出发"])
    assert(printHtml.includes(text), `PDF dropped reading content: ${text}`);
  assert(printHtml.includes('class="katex"'));
  assert(!printHtml.includes('class="katex-error"'));
  assert(!printHtml.includes("$$"));
  const pdfPremiseFormulaCount = await page.evaluate(html => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    return parsed.querySelector('li[id$="-p1"]')?.querySelectorAll(".katex").length;
  }, printHtml);
  assert.equal(pdfPremiseFormulaCount, 4);
  report.checks.push("saved undelimited premise formulas render with KaTeX in reading, the presentation's givens and exported PDF HTML");
  report.checks.push("the real PDF HTML includes every rich block and renders saved wrapped formulas");
  await application.evaluate(({BrowserWindow}, directory) => {
    let sequence = 0;
    globalThis.readingVerificationDownloads = [];
    BrowserWindow.getAllWindows()[0].webContents.session.on("will-download", (_event, item) => {
      const layout = ++sequence === 1 ? "mobile" : "desktop";
      item.setSavePath(`${directory}/${layout}.pdf`);
      item.once("done", (_event, state) => globalThis.readingVerificationDownloads.push({layout, state}));
    });
  }, output);
  for (const layout of ["mobile", "desktop"]) {
    await page.locator(".reading-pdf-layout").selectOption(layout);
    await page.getByRole("button", {name: "导出 PDF", exact: true}).click();
    const downloads = await until(
      () => application.evaluate(() => globalThis.readingVerificationDownloads),
      values => values.some(value => value.layout === layout),
    );
    assert.equal(downloads.find(value => value.layout === layout).state, "completed");
    assert((await readFile(join(output, `${layout}.pdf`))).subarray(0, 4).toString() === "%PDF");
  }
  assert.equal(await application.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows().length), 1);
  report.checks.push("phone and A4 PDFs download via Electron's built-in Chromium, with print windows cleaned up");
  await page.reload();
  await page.locator(".reading-options input").first().waitFor();
  assert(await page.locator(".reading-options input").first().isChecked());
  assert.equal(requests.filter(request => request.kind === "document").length, bodyCalls);
  const after = execFileSync("python3", ["-c", "import sqlite3,sys,json;d=sqlite3.connect(sys.argv[1]);print(json.dumps(d.execute('SELECT * FROM UnitSectionMaterial ORDER BY id').fetchall()))", database], {encoding: "utf8"});
  assert.equal(after, original);
  const componentJobs = (await readdir(join(temporary, "desktop/workspaces", workspace.workspaceId, "reading-components"))).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
  assert.equal(componentJobs.length, 6, "Each complete slot must enqueue once, never for an unfinished JSON preview");
  report.checks.push("reload restores reading and answers without regenerating; original Display/material rows are byte-for-byte unchanged");

  // Reproduce saved wide artwork and a high-resolution generated image without
  // regenerating learner content or making a paid image request.
  const wideSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1000" viewBox="0 0 1800 1000">
    <rect width="1800" height="1000" fill="white"/>
    <text x="900" y="90" text-anchor="middle" font-size="48" fill="#172033">相同温升，交换方式未必相同</text>
    <rect x="60" y="160" width="810" height="720" rx="24" fill="#eff6ff" stroke="#3b55e8" stroke-width="4"/>
    <rect x="930" y="160" width="810" height="720" rx="24" fill="#fff7ed" stroke="#c74b0d" stroke-width="4"/>
    <text x="465" y="235" text-anchor="middle" font-size="38" fill="#172033">左侧：温差传热</text>
    <text x="1335" y="235" text-anchor="middle" font-size="38" fill="#172033">右侧：外界做功</text>
    <rect x="260" y="330" width="410" height="250" rx="12" fill="#dbeafe"/>
    <rect x="1130" y="330" width="410" height="250" rx="12" fill="#ffedd5"/>
    <text x="465" y="475" text-anchor="middle" font-size="36" fill="#172033">热量进入系统</text>
    <text x="1335" y="475" text-anchor="middle" font-size="36" fill="#172033">机械功进入系统</text>
    <text x="465" y="700" text-anchor="middle" font-size="32" fill="#172033">Q = +1000 J，W_on = 0</text>
    <text x="1335" y="700" text-anchor="middle" font-size="32" fill="#172033">Q ≈ 0，W_on = +1000 J</text>
    <text x="465" y="790" text-anchor="middle" font-size="28" fill="#334155">相同的内能增量</text>
    <text x="1335" y="790" text-anchor="middle" font-size="28" fill="#334155">相同的温度变化</text>
    <text x="900" y="950" text-anchor="middle" font-size="28" fill="#334155">温升不能单独证明能量交换的方式</text></svg>`;
  const raster = await require("sharp")(Buffer.from(wideSvg)).resize(1600, 1200, {fit: "contain", background: "white"}).png().toBuffer();
  const visualCourse = structuredClone(await read());
  const visualReading = visualCourse.sections[0].reading;
  const svgSlot = visualReading.document.blocks.find(block => block.componentType === "svg");
  const imageSlot = visualReading.document.blocks.find(block => block.componentType === "plot");
  assert(svgSlot?.component && imageSlot?.component);
  visualCourse.sections[0].reading.document.blocks = [
    {id: "visual-heading", type: "heading", text: "热与功：完整阅读图示"},
    {id: "visual-prose", type: "paragraph", text: "两杯液体的温升相同，但能量进入系统的方式不同。扩大阅读区域后，可以同时比较两侧的示意和数据。"},
    {id: svgSlot.id, type: "component_slot", componentType: "svg", title: "温差传热与外界做功", description: "已保存的大画布示意图", component: {
      jobId: svgSlot.component.jobId, status: "ready", artifact: {type: "svg", svg: wideSvg, alt: "同时展示传热和做功的双栏示意", caption: "相同温升不代表能量交换的方式相同。"}}},
    {id: imageSlot.id, type: "component_slot", componentType: "image", title: "生成图片的完整阅读", description: "高分辨率的 4:3 图片", component: {
      jobId: imageSlot.component.jobId, status: "ready", artifact: {type: "image", imageUrl: `data:image/png;base64,${raster.toString("base64")}`, caption: "图片保持完整比例，也可以单独放大。"}}},
  ];
  const workspaceDirectory = join(temporary, "desktop/workspaces", workspace.workspaceId);
  for (const block of visualReading.document.blocks.filter(block => block.component)) {
    const file = join(workspaceDirectory, "reading-components", `${block.component.jobId}.json`);
    const job = JSON.parse(await readFile(file, "utf8"));
    job.artifact = block.component.artifact;
    await writeFile(file, JSON.stringify(job));
  }
  const documentFile = join(workspaceDirectory, "reading-documents", `${visualReading.jobId}.json`);
  const documentJob = JSON.parse(await readFile(documentFile, "utf8"));
  documentJob.artifact = visualReading.document;
  await writeFile(documentFile, JSON.stringify(documentJob));
  await page.setViewportSize({width: 1600, height: 1080});
  await page.reload();
  await page.locator('[data-reading-figure-type="image"] img').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-reading-figure-type="image"] img')?.naturalWidth > 0);
  const figureSizes = () => page.locator(".reading-figure-viewport").evaluateAll(elements => elements.map(element => ({
    width: element.clientWidth, contentWidth: element.scrollWidth, height: element.clientHeight, contentHeight: element.scrollHeight,
  })));
  const assertFit = async () => {
    for (const size of await figureSizes()) {
      assert(size.contentWidth <= size.width + 1, JSON.stringify(size));
      assert(size.contentHeight <= size.height + 1, JSON.stringify(size));
    }
  };
  await assertFit();
  const normalWidth = await page.locator(".reading-paper").evaluate(element => element.clientWidth);
  await page.locator('[data-reading-figure-type="svg"]').scrollIntoViewIfNeeded();
  await page.screenshot({path: join(output, "wide-svg-reading.png"), fullPage: true});
  await page.getByRole("button", {name: "进入专注模式", exact: true}).click();
  const focus = page.locator('[data-learning-flow][data-immersive-learning="true"]');
  await focus.waitFor();
  await page.waitForFunction(() => document.querySelector('.reading-paper')?.clientWidth > 1400);
  const focusedWidth = await page.locator(".reading-paper").evaluate(element => element.clientWidth);
  assert(focusedWidth > normalWidth + 180, `${normalWidth} -> ${focusedWidth}`);
  assert(await page.locator('[data-desktop-immersive-controls]').count() === 1);
  assert(await page.locator('.reading-block[data-reading-block-type="paragraph"]').evaluate(element => element.clientWidth <= 900));
  await assertFit();
  await page.locator('[data-reading-figure-type="svg"]').scrollIntoViewIfNeeded();
  await page.screenshot({path: join(output, "wide-svg-focus.png"), fullPage: true});
  await page.locator('[data-reading-figure-type="image"]').scrollIntoViewIfNeeded();
  await page.screenshot({path: join(output, "generated-image-focus.png"), fullPage: true});
  await page.locator('[data-reading-figure-type="image"]').getByRole("button", {name: "放大查看", exact: true}).click();
  await dialog.waitFor();
  await until(() => dialog.locator(".reading-figure-viewport").evaluate(element => ({w: element.clientWidth, sw: element.scrollWidth, h: element.clientHeight, sh: element.scrollHeight})),
    size => size.sw <= size.w + 1 && size.sh <= size.h + 1);
  await page.screenshot({path: join(output, "generated-image-expanded.png"), fullPage: true, animations: "disabled"});
  await page.keyboard.press("Escape");
  await dialog.waitFor({state: "detached"});
  assert.equal(await focus.count(), 1, "Dismissing a figure must keep focus mode open");
  await page.keyboard.press("Escape");
  await focus.waitFor({state: "detached"});
  report.readingWidths = {normal: normalWidth, focus: focusedWidth};
  report.checks.push("saved 1800px SVG and 1600px raster fit completely by default; focus widens the page while prose stays readable; expanded raster fits both axes and Escape closes only the figure");
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForFunction(() => document.querySelector('.reading-paper')?.clientWidth < 400);
  await assertFit();
  await page.locator('[data-reading-figure-type="svg"]').scrollIntoViewIfNeeded();
  await page.screenshot({path: join(output, "wide-svg-phone.png"), fullPage: true});
  const phoneSvg = page.locator('[data-reading-figure-type="svg"]');
  const phoneCanvasWidth = await phoneSvg.locator('.reading-figure-canvas').evaluate(element => element.clientWidth);
  await phoneSvg.getByRole("button", {name: "缩小图示", exact: true}).click();
  assert(await phoneSvg.locator('.reading-figure-canvas').evaluate(element => element.clientWidth) < phoneCanvasWidth);
  await phoneSvg.getByRole("button", {name: "适合宽度", exact: true}).click();
  await assertFit();
  report.checks.push("saved wide SVG and raster also fit a 390px reading page without clipping or nested scrolling");
  }
  await page.setViewportSize({width: 1440, height: 1000});
  await page.goto(new URL("/goals/flow-goal/units/flow-unit?view=reading", page.url()).href);
  await page.getByText("为什么等式两边要同时运算？", {exact: true}).waitFor();
  const flow = page.locator("[data-learning-flow]");
  await flow.evaluate(element => {element.dataset.sharedIdentity = "retained";});
  const previewText = await flow.innerText();
  await page.getByRole("button", {name: "演示", exact: true}).click();
  assert.equal(await flow.getAttribute("data-shared-identity"), "retained");
  assert.equal(await flow.innerText(), previewText);
  await page.screenshot({path: join(output, "shared-preview.png"), fullPage: true});
  await page.getByRole("button", {name: "阅读", exact: true}).click();
  await flow.getByRole("button", {name: "继续", exact: true}).click();
  await page.locator('[data-reading-section="flow-chapter"]').waitFor();
  assert(await page.locator(".reading-continue button").isDisabled());
  await page.getByRole("button", {name: "生成阅读", exact: true}).click();
  await until(() => api("GET", "/api/units/flow-unit/reading"), course => course.sections[0].reading?.status === "ready");
  await page.locator(".reading-continue button").click();
  await until(() => new URL(page.url()).searchParams.get("section"), section => section === "mini-test:flow-chapter");
  await page.getByText("方程 x + 1 = 3 的解是多少？", {exact: true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("section"), "mini-test:flow-chapter");
  const submit = page.getByRole("button", {name: "提交并批改", exact: true});
  assert(await submit.isDisabled());
  await page.getByText("x = 2", {exact: true}).click();
  await until(() => submit.isEnabled(), Boolean);
  const quizText = await flow.innerText();
  await page.getByRole("button", {name: "演示", exact: true}).click();
  assert.equal(await flow.getAttribute("data-shared-identity"), "retained");
  assert.equal(await flow.innerText(), quizText);
  assert(await submit.isEnabled());
  await page.getByRole("button", {name: "阅读", exact: true}).click();
  assert.equal(await flow.innerText(), quizText);
  assert(await submit.isEnabled());
  await page.screenshot({path: join(output, "shared-quiz.png"), fullPage: true});
  report.checks.push("preview is the exact same mounted UI in both modes; completion enters the shared mini-test and switching modes preserves its draft and grading gate");

  await page.goto(new URL("/goals/reading-goal/units/reading-only-unit?view=reading", page.url()).href);
  await page.locator('[data-reading-section="reading-only-chapter"]').waitFor();
  assert(await page.locator(".reading-continue button").isDisabled());
  await page.getByRole("button", {name: "生成阅读", exact: true}).click();
  const readingOnly = await until(() => api("GET", "/api/units/reading-only-unit/reading"), course => course.sections[0].reading?.status === "ready");
  await askReading("reading-only-unit", "reading-only-chapter", readingOnly.sections[0].reading.jobId, "reading-only-follow-up.png");
  report.checks.push("reading-only content supports selection, sending and persisted follow-up answers while Display remains ungenerated");
  await page.locator(".reading-continue button").click();
  const completed = await until(() => api("GET", "/api/units/reading-only-unit/sections"), sections => sections[0]?.status === "completed");
  assert.equal(completed[0].generationStatus, "pending");
  report.checks.push("a reading-only chapter completes through the shared progress action while Display remains ungenerated");
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(apiErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.error = String(error); process.exitCode = 1;
  if (page) {
    report.pageText = await page.locator("body").innerText().catch(() => "<unavailable>");
    await page.screenshot({path: join(output, "failure.png"), fullPage: true}).catch(() => {});
  }
} finally {
  releaseFirstParagraph(); releaseDocumentTail(); releaseComponents();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  // This disposable profile can have optional follow-up jobs after completion.
  // Exit explicitly instead of waiting on the interactive background-work guard.
  await application?.evaluate(({app}, code) => app.exit(code), report.status === "passed" ? 0 : 1).catch(() => {});
  await application?.close().catch(() => {});
  report.pageErrors = pageErrors; report.apiErrors = apiErrors; report.requests = requests;
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(output, "electron.log"), logs.join(""));
  await rm(temporary, {recursive: true, force: true});
  console.log(JSON.stringify(report, null, 2));
}
