const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { build } = require("esbuild");
const core = path.resolve(__dirname, "..");
const desktop = path.resolve(core, "../xue-learn-desktop");
const { chromium } = require(desktop + "/node_modules/playwright");
const output = path.join(core, "artifacts/display-plugin-library-2026-10-13");
const temporary = fs.mkdtempSync("/tmp/display-plugin-library-");
fs.mkdirSync(output, { recursive: true });
const report = { status: "running", components: [], checks: [], errors: [] };
let browser, server;
(async () => {
  try {
    await build({
      stdin: {
        contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {BrowserRouter,useSearchParams} from 'react-router-dom';
      import {DisplayPluginManager,readDisplayPluginSelection,writeDisplayPluginSelection} from '${core}/dist/display-workspace.js';
      import {builtinDisplayManifests} from '${core}/dist/display-catalog.js';
      import {I18nProvider} from '${core}/sources/src/shared/i18n/index.tsx';
      import '${core}/dist/display-workspace.css';
      import acoustic from '${core}/docs/display-plugins/acoustics.plugin.json';
      let records=builtinDisplayManifests.map(manifest=>({manifest,builtin:true,enabled:true,sha256:'builtin'}));
      const client={get:async()=>records,post:async(path,value)=>{if(path.endsWith('/import'))records=[...records,{manifest:value,builtin:false,enabled:true,sha256:'import'}];else records=records.map(record=>record.manifest.id===value.id&&record.manifest.version===value.version?{...record,enabled:value.enabled}:record);return {};}};
      function App(){const [params,setParams]=useSearchParams();window.selectComponent=(id,kind)=>{const manifest=records.find(record=>record.manifest.id===id).manifest;const component=manifest.components.find(component=>component.kind===kind);setParams(writeDisplayPluginSelection(params,{pluginId:id,pluginVersion:manifest.version,kind,componentVersion:component.version}));};return <DisplayPluginManager client={client} selection={readDisplayPluginSelection(params)} onSelectionChange={next=>setParams(writeDisplayPluginSelection(params,next))}/>;}
      window.components=builtinDisplayManifests.flatMap(manifest=>manifest.components.map(component=>({id:manifest.id,kind:component.kind})));
      createRoot(document.getElementById('app')).render(<BrowserRouter><I18nProvider><App/></I18nProvider></BrowserRouter>);
    `,
        loader: "tsx",
        resolveDir: core,
      },
      outdir: temporary,
      bundle: true,
      splitting: true,
      format: "esm",
      jsx: "automatic",
      nodePaths: [desktop + "/node_modules"],
      loader: { ".woff": "file", ".woff2": "file", ".ttf": "file" },
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env.VITE_ENABLE_DEV_TOOLS": '"false"',
      },
      plugins: [
        {
          name: "url-assets",
          setup(builder) {
            builder.onResolve({ filter: /\?url$/ }, async (args) => {
              const resolved = await builder.resolve(args.path.slice(0, -4), {
                resolveDir: args.resolveDir,
                kind: args.kind,
              });
              return { path: resolved.path, namespace: "url-asset" };
            });
            builder.onLoad(
              { filter: /.*/, namespace: "url-asset" },
              (args) => ({
                contents: fs.readFileSync(args.path),
                loader: "file",
              }),
            );
          },
        },
      ],
      logLevel: "warning",
    });
    server = http.createServer((req, res) => {
      const pathname = new URL(req.url, "http://127.0.0.1").pathname;
      if (pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end(
          '<html lang="zh-CN"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/stdin.css"><style>:root{--foreground:#403a35;--muted-foreground:#8a8074;--border:#dfd5c8;--card:#faf7f3;--muted:#eee8e0;--primary:#497363;--primary-foreground:#fff;--accent:#e9f1eb}body{margin:0;background:#f3eee8;font-family:"PingFang SC",system-ui,sans-serif}</style></head><body><div id="app"></div><script type="module" src="/stdin.js"></script></body></html>',
        );
        return;
      }
      const file = path.join(temporary, pathname);
      if (!file.startsWith(temporary + path.sep) || !fs.existsSync(file)) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader(
        "content-type",
        pathname.endsWith(".css")
          ? "text/css"
          : pathname.endsWith(".js")
            ? "text/javascript"
            : "application/octet-stream",
      );
      res.end(fs.readFileSync(file));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
    });
    page.on("pageerror", (error) => report.errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") report.errors.push(message.text());
    });
    const origin = "http://127.0.0.1:" + server.address().port;
    await page.goto(origin);
    await page.waitForSelector(".display-plugin-card");
    const settle = async () => {
      await page.waitForFunction(
        () => !document.querySelector('[data-display-placeholder="loading"]'),
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await new Promise(requestAnimationFrame);
        await new Promise(requestAnimationFrame);
      });
    };
    await settle();
    assert.equal(await page.locator(".display-plugin-card").count(), 6);
    await page.screenshot({
      path: path.join(output, "library.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "数学与推导", exact: true }).click();
    assert.equal(await page.locator(".display-plugin-card").count(), 1);
    await page.getByRole("button", { name: "全部", exact: true }).click();
    await page.getByRole("searchbox").fill("乐谱");
    assert.equal(await page.locator(".display-plugin-card").count(), 1);
    await page.getByRole("searchbox").fill("missing-query");
    await page.getByRole("button", { name: "清除筛选" }).click();
    assert.equal(await page.locator(".display-plugin-card").count(), 6);
    report.checks.push("readable search, categories and empty results");
    await page
      .getByRole("button", { name: "预览数学与推导", exact: true })
      .click();
    await settle();
    assert(page.url().includes("component=math%3Ateaching"));
    await page.screenshot({
      path: path.join(output, "math-preview.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "下一个组件" })
      .isDisabled()
      .then((value) => assert(value));
    await page.getByRole("button", { name: "上一个组件" }).click();
    await settle();
    assert(page.url().includes("component=math%3Aformal-derivation"));
    await page.goBack();
    await settle();
    assert(page.url().includes("component=math%3Ateaching"));
    await page.goForward();
    await settle();
    assert(page.url().includes("component=math%3Aformal-derivation"));
    report.checks.push("card entry, previous/next and browser back/forward");
    const components = await page.evaluate(() => window.components);
    for (const component of components) {
      await page.evaluate(
        (component) => window.selectComponent(component.id, component.kind),
        component,
      );
      await page.waitForSelector(".display-plugin-player");
      await settle();
      const tabs = page.locator(".display-plugin-example-tabs button"),
        count = await tabs.count();
      const result = { ...component, variants: count, frames: [] };
      for (let variant = 0; variant < count; variant++) {
        if (variant) await tabs.nth(variant).click();
        for (const value of [0, 150, 359]) {
          const range = page.getByRole("slider", { name: "预览进度" });
          await range.fill(
            String(Math.min(value, Number(await range.getAttribute("max")))),
          );
          await settle();
          const failures = await page
            .locator("[data-display-placeholder]")
            .evaluateAll((elements) =>
              elements.map((element) => ({
                reason: element.dataset.displayPlaceholder,
                message: element.dataset.displayMessage,
              })),
            );
          assert.deepEqual(
            failures,
            [],
            component.kind +
              " variant " +
              variant +
              " frame " +
              value +
              ": " +
              JSON.stringify(failures),
          );
          result.frames.push({ variant, frame: value });
        }
      }
      if (
        [
          "physics:motion-scene",
          "music:score",
          "computing:code",
          "math:derivation",
        ].includes(component.kind)
      )
        await page.screenshot({
          path: path.join(output, component.kind.replace(":", "-") + ".png"),
          fullPage: true,
        });
      report.components.push(result);
    }
    report.checks.push(
      "all 27 actual renderers and all examples at early/middle/late frames",
    );
    await page.evaluate(() =>
      window.selectComponent(
        "org.xuelearn.display.physics",
        "physics:motion-scene",
      ),
    );
    await settle();
    await page.getByRole("button", { name: "从头预览" }).click();
    await page.getByRole("button", { name: "播放预览" }).click();
    await page.waitForFunction(
      () =>
        Number(
          document.querySelector(".display-plugin-player [data-display-frame]")
            .dataset.displayFrame,
        ) > 10,
    );
    await page.getByRole("button", { name: "暂停预览" }).click();
    const frame = await page
      .locator(".display-plugin-player [data-display-frame]")
      .getAttribute("data-display-frame");
    await page.getByRole("slider", { name: "预览进度" }).fill("30");
    assert.equal(
      await page
        .locator(".display-plugin-player [data-display-frame]")
        .getAttribute("data-display-frame"),
      "30",
    );
    assert(Number(frame) > 10);
    report.checks.push("play, pause, restart and reverse seek");
    await page
      .locator(".display-plugin-import input")
      .setInputFiles(
        path.join(core, "docs/display-plugins/acoustics.plugin.json"),
      );
    await page.getByRole("status").filter({ hasText: "插件已安装" }).waitFor();
    await page.getByRole("button", { name: "声学与和弦", exact: true }).click();
    await settle();
    assert.equal(await page.locator("[data-display-placeholder]").count(), 0);
    await page.screenshot({
      path: path.join(output, "imported-preview.png"),
      fullPage: true,
    });
    await page.getByText("插件信息与示例数据", { exact: true }).click();
    await page.getByRole("button", { name: "停用", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已停止" }).waitFor();
    await settle();
    assert.equal(await page.locator("[data-display-placeholder]").count(), 0);
    report.checks.push(
      "imported declarative examples render and remain previewable when disabled",
    );
    const custom = {apiVersion: 1, id: "example.manual", version: "2.0.0", title: "自定义讲解", execution: "declarative", dependencies: [{id: "org.xuelearn.display.general", version: "1.0.0"}], components: [{kind: "manual:teaching", version: 2, payloadSchema: {type: "object", required: ["text"], additionalProperties: false, properties: {text: {type: "string"}}}, composition: {id: "text", kind: "general:text", version: 1, payload: {text: {$display: "payload", path: "text"}}}}]};
    await page.locator(".display-plugin-import input").setInputFiles({name: "manual.display.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(custom))});
    await page.getByRole("status").filter({hasText: "插件已安装"}).waitFor();
    await page.getByRole("button", {name: "自定义讲解", exact: true}).click();
    await page.getByText("这个组件还没有示例数据", {exact: true}).waitFor();
    await page.locator(".display-plugin-sample-import input").setInputFiles({name: "sample.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({text: "自定义插件的真实预览"}))});
    await page.waitForSelector(".display-plugin-player"); await settle();
    assert.equal(await page.locator("[data-display-placeholder]").count(), 0);
    assert((await page.locator(".display-plugin-player").innerText()).includes("自定义插件的真实预览"));
    report.checks.push("plugins without examples accept local data, preserve custom payloads and exact component versions");
    await page.getByRole("button", { name: "← 全部插件", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await settle();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(output, "library-mobile.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "预览物理与空间", exact: true })
      .click();
    await settle();
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(output, "preview-mobile.png"),
      fullPage: true,
    });
    report.checks.push("390px library and detail without horizontal overflow");
    assert.deepEqual(report.errors, []);
    report.status = "passed";
    console.log(
      JSON.stringify(
        {
          status: report.status,
          components: report.components.length,
          checks: report.checks,
          output,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    report.status = "failed";
    report.error = String(error);
    throw error;
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    fs.writeFileSync(
      path.join(output, "report.json"),
      JSON.stringify(report, null, 2),
    );
    fs.rmSync(temporary, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
