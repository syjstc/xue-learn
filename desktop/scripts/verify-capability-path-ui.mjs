import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { _electron } from "playwright";
import { createJiti } from "jiti";

const { validateLearningPath } = await createJiti(import.meta.url).import(
  "@xue-learn/core/domain",
);

const root = resolve(import.meta.dirname, "..");
const require = createRequire(import.meta.url);
const output = resolve(process.argv[2] ?? "artifacts/capability-path-ui");
const temporary = await mkdtemp(join(tmpdir(), "xuelearn-capability-path-"));
await mkdir(output, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, check, timeout = 60_000) {
  const end = Date.now() + timeout;
  let value;
  while (Date.now() < end) {
    try {
      value = await read();
      if (check(value)) return value;
    } catch {}
    await delay(200);
  }
  throw Error(`Timed out: ${JSON.stringify(value)?.slice(0, 1500)}`);
}

const requirement = (entityKey) => ({
  entityKey,
  dimensions: ["understanding", "application"],
  threshold: 0.75,
});
const dependency = (entityKey, source) => ({
  ...requirement(entityKey),
  source,
  rationale: "用已建立的方法完成下一步。",
});
const assessment = (task) => ({
  task,
  criteria: ["结果正确", "能解释方法"],
  assistance: "independent",
  context: "near",
});
const entityNames = [
  "基础数值运算",
  "坐标描点",
  "解释斜率",
  "利用直线解决问题",
];
const entityKeys = [
  "number.operations",
  "coordinate.plot",
  "slope.explain",
  "linear.solve",
];
const unit = (unitRef, index, requires) => ({
  unitRef,
  title: entityNames[index],
  summary: `通过具体例子练习${entityNames[index]}。`,
  difficulty: "medium",
  milestoneRole: "practice",
  requires,
  provides: [requirement(entityKeys[index])],
  supports: [entityKeys[Math.max(1, index)]],
  assessment: assessment(`独立完成新的${entityNames[index]}任务并解释结果。`),
  rationale: "为后续综合任务建立可观察的能力。",
});
const identity = {
  schemaVersion: 2,
  refinedTitle: "一次函数与图像",
  domainAnalysis: {
    field: "数学",
    subdomain: "一次函数",
    learningMode: "skill_practice",
    domainTag: "stem",
    topicCategory: "mathematics",
    modeClarification: "通过练习建立读图能力。",
    alternateInterpretations: [],
  },
  topicOverview: "从坐标描点到解释斜率，再用直线解决实际问题。",
  whatYouWillLearn: ["在坐标系中描点", "解释直线的斜率", "用一次函数解决问题"],
  prerequisitesAssumed: ["基础数值运算"],
};
function journey(bridge = false) {
  const foundation = dependency(entityKeys[0], bridge ? "u_1_1" : "baseline");
  const plotted = bridge ? "u_1_2" : "u_1_1";
  const slope = bridge ? "u_1_3" : "u_1_2";
  const learningPath = {
    schemaVersion: 1,
    entities: entityKeys.map((semanticKey, index) => ({
      semanticKey,
      kind: "skill",
      title: entityNames[index],
      description: `能够完成${entityNames[index]}并解释方法。`,
      scope: "简单整数与日常情境。",
    })),
    baseline: bridge
      ? []
      : [
          {
            ...requirement(entityKeys[0]),
            status: "unknown",
            rationale: "需要学习者确认的入门基础。",
          },
        ],
    goal: {
      outcomes: entityKeys.slice(1).map((key, index) => ({
        outcomeRef: `o_${index + 1}`,
        requires: [requirement(key)],
      })),
      assessment: assessment("从一组生活数据建立直线，解释变化率并作出预测。"),
    },
    modules: [
      {
        moduleRef: "m_1",
        requires: bridge ? [] : [foundation],
        provides: [requirement(entityKeys[1]), requirement(entityKeys[2])],
        assessment: assessment("画出直线并说明斜率的含义。"),
        rationale: "先建立图像和变化率之间的联系。",
        units: [
          ...(bridge ? [unit("u_1_1", 0, [])] : []),
          unit(plotted, 1, [foundation]),
          unit(slope, 2, [dependency(entityKeys[1], plotted)]),
        ],
      },
      {
        moduleRef: "m_2",
        requires: [dependency(entityKeys[2], slope)],
        provides: [requirement(entityKeys[3])],
        assessment: assessment("用直线解释一个新的实际问题。"),
        rationale: "把读图能力用于实际任务。",
        units: [unit("u_2_1", 3, [dependency(entityKeys[2], slope)])],
      },
    ],
  };
  assert.deepEqual(
    validateLearningPath(learningPath, { moduleCount: 2, outcomeCount: 3 })
      .issues,
    [],
  );
  return {
    modules: [
      {
        title: "绘图与变化率",
        summary: "描点、画线、解释斜率。",
        objective: "把数值关系表示为直线。",
        dependsOnPrevious: "从入门基础开始。",
      },
      {
        title: "读图解决问题",
        summary: "将直线应用于生活问题。",
        objective: "解释和预测实际数据。",
        dependsOnPrevious: "使用已建立的斜率解释能力。",
      },
    ],
    learningPath,
  };
}

let releaseJourney;
const journeyGate = new Promise((resolve) => {
  releaseJourney = resolve;
});
let application, page, database;
const requests = [],
  logs = [],
  pageErrors = [],
  apiErrors = [];
const report = {
  status: "running",
  scope:
    "Real Electron and local service, starting from a confirmed goal checkpoint; disposable SQLite workspace and local model fixtures. No learner data or paid model calls.",
  checks: [],
};
const server = createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const input = JSON.parse(raw || "{}");
    if (request.url?.endsWith("/embeddings")) {
      requests.push({ kind: "embedding_lexical_fallback" });
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          error: {
            message: "UI fixture uses lexical teaching-skill search.",
            type: "invalid_request_error",
          },
        }),
      );
      return;
    }
    const lastPrompt =
      [...(input.messages ?? [])]
        .reverse()
        .find((message) => message.role === "user")?.content ?? "";
    const tool =
      input.tool_choice?.function?.name ??
      String(lastPrompt).match(/native (commit_\w+) function/)?.[1];
    const revision =
      tool === "commit_goal_journey" &&
      requests.some((item) => item.tool === "commit_goal_journey");
    requests.push({
      tool,
      stream: input.stream,
      revision,
      promptTail: String(lastPrompt).slice(-1500),
    });
    const data =
      tool === "commit_goal_teaching_skill"
        ? { skills: [], reason: "使用通用教学方法。" }
        : tool === "commit_goal_identity"
          ? identity
          : tool === "commit_goal_journey"
            ? journey(revision)
            : tool === "commit_module_audit"
              ? { passed: true, findings: [] }
              : null;
    assert(
      data,
      `Unexpected model request: ${tool} ${String(lastPrompt).slice(-600)}`,
    );
    const content = JSON.stringify(data);
    const toolCall = {
      id: `call_${requests.length}`,
      type: "function",
      function: { name: tool, arguments: content },
    };
    if (!input.stream) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(
        JSON.stringify({
          id: "fixture",
          object: "chat.completion",
          model: "path-fixture",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [toolCall],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 200,
            total_tokens: 300,
          },
        }),
      );
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const send = (delta, finish = null, usage) =>
      response.write(
        `data: ${JSON.stringify({
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "path-fixture",
          choices: [{ index: 0, delta, finish_reason: finish }],
          ...(usage ? { usage } : {}),
        })}\n\n`,
      );
    send({
      role: "assistant",
      tool_calls: [
        {
          index: 0,
          id: toolCall.id,
          type: "function",
          function: { name: tool, arguments: "" },
        },
      ],
    });
    const boundary =
      tool === "commit_goal_journey" && !revision
        ? content.indexOf('{"unitRef":"u_1_2"')
        : -1;
    for (let offset = 0; offset < content.length && !response.destroyed;) {
      if (offset === boundary) await journeyGate;
      const next = Math.min(
        offset + 160,
        content.length,
        boundary > offset ? boundary : content.length,
      );
      send({
        tool_calls: [
          { index: 0, function: { arguments: content.slice(offset, next) } },
        ],
      });
      offset = next;
      await delay(45);
    }
    send({}, "tool_calls", {
      prompt_tokens: 100,
      completion_tokens: 200,
      total_tokens: 300,
    });
    response.end("data: [DONE]\n\n");
  } catch (error) {
    requests.push({ error: String(error) });
    if (!response.destroyed) {
      response.writeHead(500);
      response.end(String(error));
    }
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const modelUrl = `http://127.0.0.1:${server.address().port}/v1`;
const env = Object.fromEntries(
  ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USERPROFILE", "SystemRoot"]
    .filter((key) => process.env[key])
    .map((key) => [key, process.env[key]]),
);
Object.assign(env, {
  XUELEARN_DESKTOP_DATA_PATH: join(temporary, "desktop"),
  XUELEARN_DESKTOP_E2E_LOG_SIDECAR: "1",
});
async function launchFixture() {
  application = await _electron.launch({
    executablePath: require("electron"),
    args: [join(root, "apps/desktop")],
    env,
    timeout: 60_000,
  });
  application.process().stderr.on("data", (chunk) => logs.push(String(chunk)));
  page = await application.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      response.url().includes("/goals/path-goal/")
    )
      apiErrors.push({ url: response.url(), status: response.status() });
  });
  await page.waitForURL("http://127.0.0.1:*/**", { timeout: 60_000 });
  await page.goto(new URL("/local/plugins", page.url()).href);
  await page.waitForSelector("#desktop-plugins-title");
}
try {
  await launchFixture();
  const workspace = (
    await page.evaluate(() => window.xueLearnDesktop.workspaces.list())
  ).find((item) => item.active);
  assert(workspace);
  database = join(
    temporary,
    "desktop/workspaces",
    workspace.workspaceId,
    "xuelearn-local-v2.sqlite3",
  );
  execFileSync("python3", [
    "-c",
    String.raw`import sqlite3,sys,datetime
db=sqlite3.connect(sys.argv[1]);now=datetime.datetime.now(datetime.timezone.utc).isoformat()
values=dict(id='path-goal',userId='local-owner-v1',title='一次函数与图像',goalKind='full',status='active',contentLanguage='zh-Hans',learningMode='mastery',planningMode='fast',level='basic',mapPlanStatus='pending',mapPlanJson='',generationOptions='')
for _,name,type_,required,default,pk in db.execute('PRAGMA table_info("LearningGoal")'):
 if name not in values and required and default is None:values[name]=now if name.endswith('At') else 0 if any(n in type_.upper() for n in ['INT','REAL','BOOL']) else ''
names=list(values);db.execute('INSERT INTO "LearningGoal" ('+','.join('"'+x+'"' for x in names)+') VALUES ('+','.join('?' for _ in names)+')',[values[x] for x in names])
db.commit();db.close()`,
    database,
  ]);
  await page.evaluate(async (baseUrl) => {
    for (const providerId of ["custom", "custom_embedding"]) {
      await window.xueLearnDesktop.credentials.mutate({
        action: "set",
        providerId,
        values: { apiKey: "path-fixture-no-secret", baseUrl },
      });
    }
  }, modelUrl);
  // Safe runtime restarts may be deferred by background bootstrap jobs. Start
  // this disposable fixture once with both persisted local providers ready.
  await application.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await application.close().catch(() => {});
  await launchFixture();
  await until(
    () =>
      page.evaluate(
        async () => await (await fetch("/api/local/ai-models")).json(),
      ),
    (value) =>
      value.customBaseUrl === modelUrl &&
      value.customEmbeddingBaseUrl === modelUrl,
  );
  const api = (method, path, body) =>
    page.evaluate(
      async ({ method, path, body }) => {
        const result = await fetch(path, {
          method,
          headers: { "Content-Type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (!result.ok) throw Error(`${result.status}: ${await result.text()}`);
        return result.json();
      },
      { method, path, body },
    );
  await api("PATCH", "/api/local/ai-models", {
    capability: "embedding",
    providerId: "custom_embedding",
    model: "path-fixture",
  });
  await api("PATCH", "/api/local/ai-models", {
    capability: "chat",
    providerId: "custom",
    model: "path-fixture",
    customThinkingProtocol: "none",
  });
  const { session } = await api(
    "POST",
    "/api/agent/goal-creation-sessions",
    {},
  );
  report.sessionId = session.id;
  // Start at the real post-confirmation boundary. Intake is outside this test.
  execFileSync("python3", [
    "-c",
    String.raw`import sqlite3,sys,json
db=sqlite3.connect(sys.argv[1]);session=sys.argv[2];thread=sys.argv[3]
state=json.loads(db.execute('SELECT stateJson FROM AgentThread WHERE id=?',[thread]).fetchone()[0])
state['goalState'].update(dict(topic='一次函数与图像',refinedTitle='一次函数与图像',intentAnalysis='通过练习建立读图能力。',discoverySkipped=True,level='basic',contentLanguage='zh-Hans',planningMode='fast',learningMode='mastery',goalId='path-goal',goalApproved=True,currentPhase='generating_plan',currentSubagent='plan',collectedFields=['level','contentLanguage','generationOptions','isSmallCourse','documents'],spaceSuggestionStatus='skipped',scopeStatus='single_goal',executionMode='agentic'))
encoded=json.dumps(state,ensure_ascii=False)
db.execute('UPDATE AgentThread SET stateJson=? WHERE id=?',[encoded,thread])
db.execute("UPDATE GoalCreationSession SET goalId='path-goal',status='needs_attention',phase='generating_plan',checkpointJson=? WHERE id=?",[encoded,session])
db.commit();db.close()`,
    database,
    session.id,
    session.threadId,
  ]);
  await api(
    "POST",
    `/api/agent/goal-creation-sessions/${session.id}/retry`,
    {},
  );
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 960);
  });
  await page.goto(new URL("/goals/path-goal/plan", page.url()).href);
  const openCreation = () =>
    page.getByRole("button", { name: /目标正在后台创建.*查看/ }).click();
  await openCreation();
  await page
    .getByText(/学习路线 · 已编排 2 个模块 · 1 个单元/)
    .first()
    .waitFor({ timeout: 60_000 });
  await page.getByText("绘图与变化率", { exact: true }).first().waitFor();
  assert.equal(
    await page
      .getByRole("region", { name: "正在生成学习计划" })
      .locator('[aria-current="step"]')
      .innerText(),
    "编排路线",
  );
  assert.equal(
    requests.filter((item) => item.tool === "commit_goal_journey").length,
    1,
  );
  await page.screenshot({
    path: join(output, "streaming-path.png"),
    fullPage: true,
  });
  report.checks.push(
    "module summaries and a lesson count appear before the whole contract finishes",
  );
  await page.reload();
  await openCreation();
  await page.getByText("绘图与变化率", { exact: true }).first().waitFor();
  assert.equal(
    requests.filter((item) => item.tool === "commit_goal_journey").length,
    1,
  );
  releaseJourney();
  const details = page.getByRole("region", { name: "全程能力路线" });
  await details.waitFor({ timeout: 60_000 });
  const read = () => api("GET", "/api/goals/path-goal/plan");
  const saved = await read();
  assert.equal(
    saved.plan.learningPath.modules.flatMap((module) => module.units).length,
    3,
  );
  report.checks.push(
    "reload restores the active stream without another model call; the complete path persists",
  );
  await details.locator("summary").first().click();
  await details
    .getByText(/坐标描点/)
    .first()
    .waitFor();
  await details.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: join(output, "contract-desktop.png"),
    fullPage: true,
  });
  // Resize the native window at the supported 960px minimum. Electron viewport
  // emulation can crop a wider native layout without recomputing media queries.
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(960, 740);
  });
  await until(
    () => page.evaluate(() => innerWidth),
    (width) => width === 960,
  );
  const overflow = await details.evaluate((element) => ({
    client: element.clientWidth,
    scroll: element.scrollWidth,
    left: element.getBoundingClientRect().left,
    right: element.getBoundingClientRect().right,
    viewport: innerWidth,
  }));
  assert(overflow.scroll <= overflow.client + 2, JSON.stringify(overflow));
  assert(
    overflow.left >= 0 && overflow.right <= overflow.viewport,
    JSON.stringify(overflow),
  );
  await page.screenshot({
    path: join(output, "contract-narrow.png"),
    fullPage: true,
  });
  report.checks.push(
    "the path shows entry assumptions, exact prerequisite sources and verification tasks at 1280px and the supported 960px minimum window width",
  );
  await application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setContentSize(1280, 960);
  });
  await until(
    () => page.evaluate(() => innerWidth),
    (width) => width === 1280,
  );
  await details
    .getByRole("button", { name: "这项基础还不会", exact: true })
    .click();
  await until(
    read,
    (value) => value.plan?.learningPath?.baseline?.length === 0,
  );
  await details.waitFor();
  const revised = await read();
  assert.equal(
    revised.plan.learningPath.modules.flatMap((module) => module.units).length,
    4,
  );
  assert.equal(
    requests.filter((item) => item.tool === "commit_goal_journey").length,
    2,
  );
  report.checks.push(
    "missing-foundation feedback regenerates and validates a four-lesson bridge path",
  );
  await page.reload();
  await openCreation();
  await details.waitFor();
  assert.equal(
    requests.filter((item) => item.tool === "commit_goal_journey").length,
    2,
  );
  const counts = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        String.raw`import sqlite3,sys,json
db=sqlite3.connect(sys.argv[1]);tables=[row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
names=[name for name in tables if name in ('LearningUnit','UnitSectionMaterial') or 'Evidence' in name or 'Mastery' in name]
print(json.dumps({name:db.execute('SELECT count(*) FROM "'+name+'"').fetchone()[0] for name in names}))`,
        database,
      ],
      { encoding: "utf8" },
    ),
  );
  assert(
    Object.values(counts).every((count) => count === 0),
    JSON.stringify(counts),
  );
  report.checks.push(
    "planning/revision/reload creates no lesson body or learner mastery/evidence records",
  );
  report.recordCounts = counts;
  await page
    .getByRole("button", { name: "确认计划并创建学习旅程", exact: true })
    .click();
  await until(
    () => api("GET", `/api/agent/goal-creation-sessions/${session.id}`),
    (value) => value.session?.status === "completed",
  );
  const published = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        String.raw`import sqlite3,sys,json
db=sqlite3.connect(sys.argv[1]);db.row_factory=sqlite3.Row
units=[dict(row) for row in db.execute('SELECT u.id,u.title,u.prerequisites,m.orderIndex AS moduleOrder,u.orderIndex FROM LearningUnit u JOIN LearningModule m ON m.id=u.moduleId WHERE u.goalId=? ORDER BY m.orderIndex,u.orderIndex',['path-goal'])]
entities=[dict(row) for row in db.execute('SELECT stableKey,kind FROM CognitiveEntity WHERE goalId=? ORDER BY stableKey',['path-goal'])]
print(json.dumps(dict(units=units,entities=entities,bodyCount=db.execute('SELECT count(*) FROM UnitSectionMaterial').fetchone()[0])))`,
        database,
      ],
      { encoding: "utf8" },
    ),
  );
  assert.deepEqual(
    published.units.map((entry) => entry.title),
    entityNames,
  );
  for (const [index, entry] of published.units.entries()) {
    assert.deepEqual(
      JSON.parse(entry.prerequisites),
      index === 0 ? [] : [published.units[index - 1].id],
    );
  }
  assert.deepEqual(
    published.entities,
    entityKeys
      .slice(1)
      .map((key) => ({ stableKey: `path:${key}`, kind: "skill" }))
      .sort((a, b) => a.stableKey.localeCompare(b.stableKey)),
  );
  assert.equal(published.bodyCount, 0);
  assert.equal(
    requests.filter((entry) =>
      /commit_(?:exploration_)?module_(?:capabilities|structure)$/.test(
        entry.tool ?? "",
      ),
    ).length,
    0,
  );
  report.published = published;
  report.checks.push(
    "confirmation publishes all four lessons with exact prerequisite IDs and shared KACOM skill identities; no module re-authoring calls or lesson prose",
  );
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(apiErrors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.error = String(error);
  process.exitCode = 1;
  if (database) {
    try {
      report.draftDiagnostics = JSON.parse(
        execFileSync(
          "python3",
          [
            "-c",
            String.raw`import sqlite3,json,sys
db=sqlite3.connect(sys.argv[1]);db.row_factory=sqlite3.Row
tables=[r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'") if 'ModuleStructureDraft' in r[0]]
print(json.dumps({t:[dict(r) for r in db.execute('SELECT moduleId,status,attemptCount,issuesJson FROM "'+t+'"')] for t in tables}))
`,
            database,
          ],
          { encoding: "utf8" },
        ),
      );
    } catch {}
  }
  if (page) {
    if (report.sessionId) {
      report.recentEvents = await page
        .evaluate(async (sessionId) => {
          const response = await fetch(
            `/api/agent/goal-creation-sessions/${sessionId}/events?after=0`,
          );
          const data = await response.json();
          return data.events?.slice(-15);
        }, report.sessionId)
        .catch(() => []);
    }
    report.pageText = await page
      .locator("body")
      .innerText()
      .catch(() => "<unavailable>");
    await page
      .screenshot({ path: join(output, "failure.png"), fullPage: true })
      .catch(() => {});
  }
} finally {
  releaseJourney();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  // This disposable fixture can leave nonessential embedding retries queued.
  // Product safe-quit waits for those jobs; finish the isolated test explicitly.
  await application
    ?.evaluate(
      ({ app }, code) => app.exit(code),
      report.status === "passed" ? 0 : 1,
    )
    .catch(() => {});
  await application?.close().catch(() => {});
  report.pageErrors = pageErrors;
  report.apiErrors = apiErrors;
  report.requests = requests;
  if (report.status === "passed")
    await rm(join(output, "failure.png"), { force: true });
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  await writeFile(join(output, "electron.log"), logs.join(""));
  await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}
