import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright';

// Build renderer, native host, staged local service and example manifests first.
// This acceptance run never starts the user's normal application profile.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const output = resolve(process.argv.slice(2).find(value => value !== '--') ?? join(root, 'artifacts/embedded-plugins-native'));
const directory = join(root, 'examples/plugins/course-browser');
const manifest = JSON.parse(await readFile(join(directory, 'plugin.json'), 'utf8'));
assert.equal(manifest.runtime, undefined, 'The fixture must be a UI-only plugin');
const temporary = await mkdtemp(join(tmpdir(), 'xuelearn-embedded-plugin-'));
await mkdir(output, { recursive: true });
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USERPROFILE', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { XUELEARN_DESKTOP_DATA_PATH: join(temporary, 'desktop'), XUELEARN_DESKTOP_E2E_LOG_SIDECAR: '1' });
const logs = [], pageErrors = [];
const report = { status: 'running', checks: [], pluginId: manifest.id, scope: 'Disposable profile; actual Electron host, installed renderer module, shared React/UI and real empty workspace course service. No learner data, model credentials or paid generation.' };
let application, page;

async function snapshotProcesses() {
  return application.evaluate(({ app, BrowserWindow }) => ({
    windows: BrowserWindow.getAllWindows().map(window => window.id),
    metrics: app.getAppMetrics().map(({ pid, type, name, serviceName }) => ({ pid, type, name, serviceName })),
  }));
}
async function viewSession() {
  return page.evaluate(id => {
    const link = document.querySelector(`link[data-desktop-plugin="${id}"]`);
    if (!link) throw Error('Plugin stylesheet session is missing');
    const url = new URL(link.href);
    return { sessionId: url.pathname.split('/')[1], stylesheetUrl: link.href, moduleUrl: new URL('module.mjs', link.href).href };
  }, manifest.id);
}
async function expectRevoked(session) {
  const result = await page.evaluate(async session => {
    let error;
    try { await window.xueLearnPlugins.callView(session.sessionId, 'workspace.courses', 'catalog'); }
    catch (cause) { error = String(cause); }
    return { error };
  }, session);
  assert.match(result.error ?? '', /closed|changed|active|cancelled/i);
  // A revoked response has no CORS header, so browser fetch correctly refuses it.
  // Read the protocol's real status through Electron's same default session.
  const assetStatus = await application.evaluate(async ({ net }, url) => (await net.fetch(url)).status, session.moduleUrl);
  assert.equal(assetStatus, 404);
}

try {
  application = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'apps/desktop')], env, timeout: 60_000 });
  application.process().stderr?.on('data', chunk => logs.push(chunk.toString()));
  page = await application.firstWindow({ timeout: 60_000 });
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.waitForURL('http://127.0.0.1:*/**', { timeout: 90_000 });
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/local/plugins`);
  await page.waitForSelector('#desktop-plugins-title');
  assert.deepEqual(await page.evaluate(() => window.xueLearnPlugins.list()), []);
  await application.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, directory);
  await page.evaluate(() => window.xueLearnPlugins.install());
  const installed = await page.evaluate(() => window.xueLearnPlugins.list());
  assert.equal(installed.length, 1);
  assert.equal(installed[0].status, 'disabled');
  assert.deepEqual(installed[0].missingCapabilities, []);
  report.checks.push('installed through native folder picker and trusted main-frame IPC', 'UI-only package verifies integrity and installs disabled');

  const before = await snapshotProcesses();
  assert.equal(before.windows.length, 1);
  const healthBefore = await page.evaluate(() => window.xueLearnDesktop.sidecar.getHealth());
  assert.equal(healthBefore.status, 'ready');
  await page.evaluate(id => window.xueLearnPlugins.enable(id), manifest.id);
  const href = `/local/plugins/${manifest.id}/views/courses`;
  await page.locator(`a[href="${href}"]`).click();
  await page.waitForSelector('.course-browser');
  await page.waitForFunction(() => document.querySelector('.course-browser-count')?.textContent === '0 节课程');
  assert.equal(page.url(), `${origin}${href}`);
  const session = await viewSession();
  assert.match(session.moduleUrl, /^xuelearn-plugin:\/\/view\//);
  const appearance = await page.evaluate(id => ({
    stylesheetLoaded: Boolean(document.querySelector(`link[data-desktop-plugin="${id}"]`)?.sheet),
    layout: getComputedStyle(document.querySelector('.course-browser')).display,
    columns: getComputedStyle(document.querySelector('.course-browser-layout')).gridTemplateColumns,
    hostButton: Boolean(document.querySelector('.course-browser button[data-slot="button"]')),
    hostInput: Boolean(document.querySelector('.course-browser input')),
  }), manifest.id);
  assert.equal(appearance.stylesheetLoaded, true);
  assert.equal(appearance.layout, 'grid');
  assert.equal(appearance.hostButton, true);
  assert.equal(appearance.hostInput, true);
  const search = page.getByRole('searchbox', { name: '搜索课程、章节或空间' });
  await search.fill('acceptance-query');
  await page.getByText('没有匹配的课程', { exact: true }).waitFor();
  await search.fill('');
  await page.getByText('当前工作区还没有课程', { exact: true }).waitFor();
  await page.getByRole('button', { name: '刷新', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.course-browser-count')?.textContent === '0 节课程');
  report.checks.push('embedded view opens inside the existing Desktop route', 'verified module and stylesheet load through xuelearn-plugin under real CSP', 'host React hooks, Button/Input/Card and plugin CSS render and respond to input', 'actual workspace catalog loads and refreshes without plugin HTTP server');

  const reads = await page.evaluate(async session => ({
    catalog: await window.xueLearnPlugins.callView(session.sessionId, 'workspace.courses', 'catalog'),
    missing: await window.xueLearnPlugins.callView(session.sessionId, 'workspace.courses', 'readUnit', { unitId: 'acceptance-missing-unit' }),
    undeclared: await window.xueLearnPlugins.callView(session.sessionId, 'display.workspace', 'plugins').then(() => null, error => String(error)),
    forged: await window.xueLearnPlugins.callView(session.sessionId, 'workspace.courses', 'catalog', { workspaceId: 'forged' }).then(() => null, error => String(error)),
  }), session);
  assert.deepEqual(reads.catalog, []);
  assert.equal(reads.missing, null);
  assert.match(reads.undeclared, /did not declare/);
  assert.match(reads.forged, /Invalid host capability arguments/);
  const after = await snapshotProcesses();
  assert.deepEqual(after.windows, before.windows);
  const initialUtilities = new Set(before.metrics.filter(metric => metric.type === 'Utility').map(metric => metric.pid));
  const newUtilities = after.metrics.filter(metric => metric.type === 'Utility' && !initialUtilities.has(metric.pid));
  assert.deepEqual(newUtilities, [], 'UI-only activation must not launch a plugin utility process');
  assert.equal(after.metrics.some(metric => /XueLearn Plugin/.test(`${metric.name ?? ''} ${metric.serviceName ?? ''}`)), false);
  report.processes = { before, after };
  report.appearance = appearance;
  report.checks.push('course reads stay in selected workspace and missing source returns null', 'undeclared capability and caller-supplied workspace rejected', 'same BrowserWindow and no new plugin process after activation');
  await page.screenshot({ path: join(output, 'embedded-course-browser.png'), fullPage: true });

  await page.evaluate(id => window.xueLearnPlugins.disable(id), manifest.id);
  await page.waitForSelector('.course-browser', { state: 'detached' });
  await page.getByRole('alert').waitFor();
  await expectRevoked(session);
  assert.equal(await page.locator(`link[data-desktop-plugin="${manifest.id}"]`).count(), 0);
  await page.screenshot({ path: join(output, 'disabled-view.png'), fullPage: true });
  report.checks.push('disable unmounts UI and revokes existing capability calls and module assets');

  await page.locator('a[href="/local/plugins"]').last().click();
  await page.waitForSelector('#desktop-plugins-title');
  await page.evaluate(id => window.xueLearnPlugins.enable(id), manifest.id);
  await page.locator(`a[href="${href}"]`).click();
  await page.waitForFunction(() => document.querySelector('.course-browser-count')?.textContent === '0 节课程');
  const reopened = await viewSession();
  assert.notEqual(reopened.sessionId, session.sessionId);
  await page.locator('a[href="/local/plugins"]').last().click();
  await page.waitForSelector('#desktop-plugins-title');
  await expectRevoked(reopened);
  assert.equal(await page.locator(`link[data-desktop-plugin="${manifest.id}"]`).count(), 0);
  await page.evaluate(async id => { await window.xueLearnPlugins.disable(id); await window.xueLearnPlugins.remove(id); }, manifest.id);
  assert.deepEqual(await page.evaluate(() => window.xueLearnPlugins.list()), []);
  const healthAfter = await page.evaluate(() => window.xueLearnDesktop.sidecar.getHealth());
  assert.equal(healthAfter.status, 'ready');
  assert.equal(healthAfter.instanceId, healthBefore.instanceId);
  assert.deepEqual(pageErrors, []);
  report.checks.push('re-enable creates a fresh session; route exit removes stylesheet and revokes calls', 'removal preserves the same ready learning workspace service');
  report.status = 'passed';
  await rm(join(output, 'failure.png'), { force: true });
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.status = 'failed'; report.error = String(error);
  if (page) {
    report.pageUrl = page.url();
    report.pageText = await page.locator('body').innerText().catch(() => 'unavailable');
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  }
  throw error;
} finally {
  report.pageErrors = pageErrors;
  if (application) await application.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'process.log'), logs.join(''));
  await rm(temporary, { recursive: true, force: true });
}
