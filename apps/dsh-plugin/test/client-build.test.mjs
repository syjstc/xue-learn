import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';

const desktop = createRequire(new URL('../../../desktop/package.json', import.meta.url));
const postcss = createRequire(desktop.resolve('@tailwindcss/postcss'))('postcss');

test('the shipped client includes native spaces, course navigation and the right assistant', async () => {
  const meta = JSON.parse(await readFile(new URL('../.build/client.metafile.json', import.meta.url), 'utf8'));
  const inputs = Object.keys(meta.inputs);
  for (const component of ['pages/learning-spaces-page', 'pages/learning-space-page',
    'layout/goal-unit-sidebar-nav', 'pages/goal-module-page', 'pages/unit-page',
    'agent/assistant-provider', 'agent/assistant-companion-shell', 'pages/unit-diagnostic-page']) {
    assert.ok(inputs.some(path => path.includes(component)), component);
  }
  assert.ok(!inputs.some(path => path.endsWith('client/presentation.tsx')));
  for (const standalone of ['layout/account-menu.tsx', 'settings/teaching-persona-settings.tsx',
    'settings/llm-settings-form.tsx', '/teaching-personas/xiaohui_female.webp']) {
    assert.ok(!inputs.some(path => path.includes(standalone)), `Standalone UI leaked: ${standalone}`);
  }
});

test('the complete Desktop stylesheet stays isolated from the DSH shell', async () => {
  const css = await readFile(new URL('../dist/client.css', import.meta.url), 'utf8');
  const root = postcss.parse(css);
  root.walkRules(rule => {
    let parent = rule.parent;
    while (parent && !(parent.type === 'atrule' && (parent.name === 'scope' || /keyframes$/.test(parent.name)))) parent = parent.parent;
    assert.ok(parent || rule.selector.split(',').every(selector => selector.trim().startsWith('.xuelearn-workbench')),
      `Host CSS leaked: ${rule.selector}`);
  });
  assert.match(css, /@container xuelearn/);
  assert.match(css, /@scope \(\.xuelearn-workbench\)/);
  assert.match(css, /:scope\.dark\s*\{/);
  assert.match(css, /--xuelearn-host-height/);
  assert.match(css, /data:image\/png;base64/);
  assert.doesNotMatch(css, /url\(["']?\/haohuixue/);
});

test('the native course entry ships the fixed-coordinate renderer styles', async () => {
  const css = await readFile(new URL('../dist/client.css', import.meta.url), 'utf8');
  const rules = [];
  postcss.parse(css).walkRules(rule => rules.push(rule));
  for (const [selector, property, expected] of [
    ['.display-film-stage', 'position', 'relative'],
    ['.display-film-canvas', 'position', 'absolute'],
    ['.display-film-teaching', 'position', 'absolute'],
    ['.rt-diagram', 'height', '100%'],
  ]) {
    assert.ok(rules.some(rule => rule.selector === selector && rule.nodes.some(node =>
      node.type === 'decl' && node.prop === property && node.value === expected)),
    `Missing ${selector} ${property}: ${expected}; native pages must not depend on the optional Presentation page`);
  }
});
