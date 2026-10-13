import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { _electron } from 'playwright';

// Runs a real Desktop, Cordis utility worker and (optionally) Video in disposable profiles.
// Build Desktop's renderer, native host and staged local service before invoking this script.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, '..');
const arguments_ = process.argv.slice(2).filter(argument => argument !== '--');
const output = resolve(arguments_[1] ?? join(root, 'artifacts/desktop-plugins-native'));
const videoBundle = arguments_[0] ? resolve(arguments_[0]) : undefined;
const temporary = await mkdtemp(join(tmpdir(), 'xuelearn-plugin-host-'));
await mkdir(output, { recursive: true });
const crashFixture = join(temporary, 'fixture');
await mkdir(crashFixture);
const source = `module.exports = {inject:['desktop'], apply(ctx) {
ctx.effect(() => ctx.desktop.registerCommand('fixture.inspect', async (_args, invocation) => invocation.call('workspace.connection','get')));
ctx.effect(() => ctx.desktop.registerCommand('fixture.crash', () => {process.exit(31)}));
}};`;
await writeFile(join(crashFixture, 'plugin.cjs'), source);
await writeFile(join(crashFixture, 'plugin.json'), JSON.stringify({
  schemaVersion: 1, apiVersion: 1, id: 'org.xuelearn.acceptance', name: '插件隔离验收', version: '0.1.0',
  runtime: { entry: 'plugin.cjs' }, requires: { 'workspace.connection': 1 },
  contributes: { commands: [{ id: 'fixture.inspect', title: '读取当前工作区' }, { id: 'fixture.crash', title: '模拟插件故障' }] },
  integrity: { 'plugin.cjs': createHash('sha256').update(source).digest('hex') },
}));
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'USERPROFILE', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
Object.assign(env, { XUELEARN_DESKTOP_DATA_PATH: join(temporary, 'desktop'), XUELEARN_DESKTOP_E2E_LOG_SIDECAR: '1' });
const logs = [];
let app;
let page;
const report = { status: 'running', checks: [], videoBundle };
try {
  app = await _electron.launch({ executablePath: require('electron'), args: [join(root, 'apps/desktop')], env, timeout: 60_000 });
  app.process().stderr?.on('data', chunk => logs.push(chunk.toString()));
  page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForURL('http://127.0.0.1:*/**', { timeout: 90_000 });
  const origin = new URL(page.url()).origin;
  await page.goto(`${origin}/local/plugins`);
  await page.waitForFunction(() => typeof window.xueLearnPlugins?.list === 'function');
  await page.waitForSelector('#desktop-plugins-title');
  assert.deepEqual(await page.evaluate(() => window.xueLearnPlugins.list()), []);
  const install = async directory => {
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, directory);
    return page.evaluate(() => window.xueLearnPlugins.install());
  };
  await install(crashFixture);
  const installed = await page.evaluate(() => window.xueLearnPlugins.list());
  assert.equal(installed[0].status, 'disabled');
  await page.evaluate(() => window.xueLearnPlugins.enable('org.xuelearn.acceptance'));
  const connection = await page.evaluate(() => window.xueLearnPlugins.execute('org.xuelearn.acceptance', 'fixture.inspect'));
  assert(connection.workspaceId && connection.brokerPath.startsWith(temporary));
  report.checks.push('main-window IPC guard and folder installer', 'disabled-by-default installation', 'Cordis activation in Electron utility process', 'workspace-scoped host capability');
  const before = await page.evaluate(() => window.xueLearnDesktop.sidecar.getHealth());
  await page.evaluate(() => window.xueLearnPlugins.execute('org.xuelearn.acceptance', 'fixture.crash').catch(() => undefined));
  await page.waitForFunction(async () => (await window.xueLearnPlugins.list())[0].status === 'failed');
  const after = await page.evaluate(() => window.xueLearnDesktop.sidecar.getHealth());
  assert.equal(after.status, 'ready');
  assert.equal(after.instanceId, before.instanceId);
  report.checks.push('plugin crash leaves the same learning process ready');
  await page.screenshot({ path: join(output, 'plugin-failure-isolation.png'), fullPage: true });
  await page.evaluate(() => window.xueLearnPlugins.disable('org.xuelearn.acceptance'));
  await page.evaluate(() => window.xueLearnPlugins.remove('org.xuelearn.acceptance'));
  if (videoBundle) {
    const manifest = JSON.parse(await readFile(join(videoBundle, 'plugin.json'), 'utf8'));
    await install(videoBundle);
    await page.evaluate(id => window.xueLearnPlugins.enable(id), manifest.id);
    const selection = { profilePath: join(temporary, 'video-profile'), videoWorkspace: join(temporary, 'video-projects') };
    const opened = await page.evaluate(({ id, selection }) => window.xueLearnPlugins.execute(id, 'video.open', selection), { id: manifest.id, selection });
    assert.equal(opened.opened, true);
    assert.equal(opened.workspaceId, connection.workspaceId);
    await page.screenshot({ path: join(output, 'video-plugin-active.png'), fullPage: true });
    await page.evaluate(id => window.xueLearnPlugins.disable(id), manifest.id);
    assert.equal((await page.evaluate(() => window.xueLearnDesktop.sidecar.getHealth())).status, 'ready');
    await page.evaluate(id => window.xueLearnPlugins.enable(id), manifest.id);
    await page.evaluate(id => window.xueLearnPlugins.disable(id), manifest.id);
    await page.evaluate(id => window.xueLearnPlugins.remove(id), manifest.id);
    report.checks.push('Video bundle installed and verified', 'Video native readiness through actual Cordis worker and Desktop broker', 'Video graceful disable and re-enable', 'learning service survives Video lifecycle');
  }
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
  if (app) await app.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'process.log'), logs.join(''));
  await rm(temporary, { recursive: true, force: true });
}
