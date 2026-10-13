import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const examples = [{
  directory: 'workspace-inspector',
  files: ['plugin.cjs'],
  manifest: {
    schemaVersion: 1,
    id: 'org.xuelearn.workspace-inspector',
    name: 'Workspace Inspector',
    version: '0.1.0',
    apiVersion: 1,
    description: 'Checks that the current workspace is connected through the Desktop plugin host.',
    runtime: { entry: 'plugin.cjs' },
    requires: { 'workspace.connection': 1 },
    contributes: { commands: [{ id: 'workspace.inspect', title: 'Inspect current workspace' }] },
  },
}, {
  directory: 'course-browser',
  files: ['view.mjs', 'view.css'],
  manifest: {
    schemaVersion: 1,
    id: 'org.xuelearn.course-browser',
    name: '课程浏览器',
    version: '0.1.0',
    apiVersion: 1,
    description: '在宿主界面中浏览当前工作区的课程，复用宿主的 React、UI 组件和课程能力。',
    requires: { 'workspace.courses': 1 },
    contributes: { views: [{ id: 'courses', title: '课程浏览器', entry: 'view.mjs', stylesheet: 'view.css' }] },
  },
}];

for (const example of examples) {
  const directory = new URL(`../examples/plugins/${example.directory}/`, import.meta.url);
  const integrity = {};
  for (const file of example.files) {
    integrity[file] = createHash('sha256').update(await readFile(new URL(file, directory))).digest('hex');
  }
  const manifest = { ...example.manifest, integrity };
  await writeFile(new URL('plugin.json', directory), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Built ${fileURLToPath(directory)}`);
}
