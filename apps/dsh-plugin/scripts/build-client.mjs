import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, join} from 'node:path';
import {mkdir, readFile, writeFile, rm} from 'node:fs/promises';
import {statSync} from 'node:fs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const desktop = resolve(root, '../../desktop');
const requireDesktop = createRequire(join(desktop, 'package.json'));
const requirePlugin = createRequire(join(root, 'package.json'));
const {build} = requireDesktop('esbuild');
const tailwind = requireDesktop('@tailwindcss/postcss');
const postcss = createRequire(requireDesktop.resolve('@tailwindcss/postcss'))('postcss');
const output = join(root, 'dist');
await mkdir(output, {recursive: true});
const buildOutput = join(root, '.build');
await mkdir(buildOutput, {recursive: true});
const aliases = {
  '@/shared/api-client': join(root, 'client/api-client.ts'),
  '@/shared/api': join(root, 'client/api.ts'),
  '@/shared/runtime/local-client-preferences': join(root, 'client/client-preferences.ts'),
  '@/components/theme/theme-provider': join(root, 'client/theme-provider.tsx'),
  '@/components/layout/account-menu': join(root, 'client/learning-settings-link.tsx'),
  '@/components/settings/quick-settings-panel': join(root, 'client/quick-settings-panel.tsx'),
  '@/components/settings/use-settings-sections': join(root, 'client/settings-sections.ts'),
  '@/pages/settings-page': join(root, 'client/settings-page.tsx'),
  '@/shared/teaching-persona-avatar': join(root, 'client/assistant-identity.ts'),
  '@/shared/teaching-persona-i18n': join(root, 'client/assistant-identity.ts'),
  '@/components/goals/sequential-journey-path': join(root, 'client/sequential-journey-path.tsx'),
  '@/features/plugins/ui-extensions': join(root, 'client/desktop-plugins.tsx'),
  '@/features/plugins/plugin-view': join(root, 'client/desktop-plugins.tsx'),
  '@/components/desktop-python-editor/editor-pane': join(root, 'client/python-pane-unavailable.tsx'),
  '@xue-learn/core/shared/runtime/local-preferences': join(root, 'client/appearance.ts'),
};
const bundle = await build({
  entryPoints: [join(root, 'client/index.tsx')], outdir: output, bundle: true,
  write: false, format: 'cjs', platform: 'browser', target: 'es2022',
  jsx: 'automatic', minify: true, legalComments: 'eof', metafile: true,
  nodePaths: [join(desktop, 'node_modules')],
  external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  define: {'process.env.NODE_ENV': '"production"', 'import.meta.env.VITE_ENABLE_DEV_TOOLS': '"false"', 'import.meta.env.DEV': 'false'},
  loader: {'.woff': 'dataurl', '.woff2': 'dataurl', '.ttf': 'dataurl', '.svg': 'dataurl', '.png': 'dataurl', '.webp': 'dataurl'},
  plugins: [{name: 'learning-host-imports', setup(api) {
    api.onResolve({filter: /^@base-ui\/react\/(dialog|alert-dialog|popover|menu|tooltip|select)$/}, args => ({
      path: args.path, namespace: 'embedded-base-ui',
    }));
    api.onLoad({filter: /.*/, namespace: 'embedded-base-ui'}, args => {
      const name = args.path.split('/').at(-1).split('-').map(word => word[0].toUpperCase() + word.slice(1)).join('');
      const source = requireDesktop.resolve(args.path);
      return {resolveDir: desktop, loader: 'tsx', contents: `
        import {${name} as Primitive} from ${JSON.stringify(source)};
        import {createElement, forwardRef, useContext} from 'react';
        import {EmbeddedPortalContext} from ${JSON.stringify(join(root, 'client/embedded-portal.tsx'))};
        export * from ${JSON.stringify(source)};
        const EmbeddedPortal = forwardRef(function EmbeddedPortal(props, ref) {
          const container = useContext(EmbeddedPortalContext);
          return createElement(Primitive.Portal, {...props, ref, container: props.container ?? container,
            className: ['xuelearn-dsh-portal', props.className].filter(Boolean).join(' ')});
        });
        export const ${name} = {...Primitive, Portal: EmbeddedPortal};
      `};
    });
    api.onLoad({filter: /\/desktop\/src\/.*\.[tj]sx?$/}, async args => {
      let contents = await readFile(args.path, 'utf8');
      let imports = '';
      const assets = new Map();
      contents = contents.replace(/(["'])(\/[^"'\s]+\.(?:png|webp|svg))\1/g, (match, quote, asset, index, input) => {
        if (input.slice(0, index).endsWith('url(') || !statSync(join(desktop, 'public', asset), {throwIfNoEntry: false})?.isFile()) return match;
        if (!assets.has(asset)) assets.set(asset, `embeddedAsset${assets.size}`);
        const name = assets.get(asset);
        return /\b(?:src|srcSet|poster)=$/.test(input.slice(0, index)) ? `{${name}}` : name;
      });
      for (const [asset, name] of assets) imports += `import ${name} from ${JSON.stringify(join(desktop, 'public', asset))};\n`;
      if (args.path.endsWith('/layout/settings-workspace-subview.tsx')) {
        contents = contents.replace('t("settings.pageDescription")', 't("settings.learningView.description")');
      }
      if (/window\.inner(?:Width|Height)/.test(contents) || args.path.endsWith('/layout/workspace-shell.tsx')) {
        imports += `import {embeddedViewport as __xuelearnViewport} from ${JSON.stringify(join(root, 'client/viewport.ts'))};\n`;
        contents = contents.replaceAll('window.innerWidth', '__xuelearnViewport().width').replaceAll('window.innerHeight', '__xuelearnViewport().height');
        if (args.path.endsWith('/layout/workspace-shell.tsx')) contents = contents.replaceAll('updateExplorerWidth(moveEvent.clientX)', 'updateExplorerWidth(moveEvent.clientX - __xuelearnViewport().left)');
        if (args.path.endsWith('/agent/assistant-companion-shell.tsx')) contents = contents.replaceAll('viewport.width - moveEvent.clientX', '__xuelearnViewport().right - moveEvent.clientX');
      }
      if (args.path.endsWith('/features/reading/reading-course-view.tsx')) {
        // Native EventSource cannot attach the authenticated IPC carrier header.
        // Use the same streaming fetch transport as assistant/generation events.
        imports += `import {LearningEventSource} from ${JSON.stringify(join(root, 'client/event-source.ts'))};\n`;
        contents = contents.replace('allowPdfExport = true', 'allowPdfExport = false')
          .replace('new EventSource(apiUrl(`${path}/events`))', 'new LearningEventSource(`${path}/events`)');
      }
      if (args.path.endsWith('/layout/assistant-fab.tsx')) {
        for (const key of ['openWithReply', 'open', 'title']) {
          contents = contents.replace(`t("uiChrome.assistant.${key}", { name: personaName })`,
            `t("uiChrome.assistant.${key}", { name: "" }).replace(/\\s+/g, " ").trim()`);
        }
      }
      if (/\/(?:immersive-learning-chrome\.tsx|use-immersive-learning\.ts)$/.test(args.path)) {
        imports += `import {embeddedSurface as __xuelearnSurface} from ${JSON.stringify(join(root, 'client/viewport.ts'))};\n`;
        contents = contents.replaceAll('document.body', '(__xuelearnSurface() ?? document.body)');
      }
      return {contents: imports + contents, loader: args.path.endsWith('x') ? 'tsx' : 'ts'};
    });
    api.onResolve({filter: /^\.\/reading-figure$/}, () => ({path: join(root, 'client/reading-figure.tsx')}));
    api.onResolve({filter: /(?:^|\/)python-editor-provider(?:\.js|\.tsx)?$/}, () => ({path: join(root, 'client/python-editor-unavailable.ts')}));
    api.onResolve({filter: /(?:^|\/)lab-frame-host(?:\.tsx)?$/}, () => ({path: join(root, 'client/lab-unavailable.tsx')}));
    // These shared visual components only need the image-provider capability.
    // DSH v1 uses its LLM for diagrams and has no separate image-provider settings.
    api.onResolve({filter: /^@\/hooks\/api$/}, args => /(?:svg-diagram|illustration)\.tsx$/.test(args.importer)
      ? {path: join(root, 'client/image-settings-unavailable.ts')} : undefined);
    // Music's SVG labels render static markup. Its renderer must match DSH's
    // React 18 singleton, rather than Desktop's React 19 server implementation.
    api.onResolve({filter: /^react-dom\/server$/}, () => ({path: requirePlugin.resolve('react-dom-host/server.browser')}));
    api.onResolve({filter: /\?url$/}, async args => {
      const result = await api.resolve(args.path.slice(0, -4), {resolveDir: args.resolveDir, kind: 'import-statement'});
      return {path: result.path, namespace: 'resource-url'};
    });
    api.onLoad({filter: /.*/, namespace: 'resource-url'}, async args => ({contents: `export default ${JSON.stringify(`data:text/javascript;base64,${(await readFile(args.path)).toString('base64')}`)}`, loader: 'js'}));
    api.onResolve({filter: /^(?:@\/|@xue-learn\/core\/shared\/runtime\/local-preferences$)/}, args => {
      for (const [specifier, path] of Object.entries(aliases)) if (args.path === specifier) return {path};
      const base = resolve(desktop, 'src', args.path.slice(2));
      const path = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx']
        .map(suffix => base + suffix).find(path => statSync(path, {throwIfNoEntry: false})?.isFile());
      if (!path) throw new Error(`Cannot resolve ${args.path}`);
      return {path};
    });
  }}],
});
const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))?.text;
if (!js) throw new Error('Client bundler produced no JavaScript');
const moduleCss = bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
// Use Desktop's complete stylesheet, including its reset, utilities and tokens.
// A partial utility build left native pages with inherited DSH margins/fonts.
const desktopInput = await readFile(join(desktop, 'src/globals.css'), 'utf8');
const utility = await postcss([tailwind({base: desktop, optimize: true})]).process(
  `${desktopInput}\n@source "${join(root, 'client')}";\n@source "${resolve(root, '../../core/sources/src/components')}";`,
  {from: join(desktop, 'src/globals.css')},
);
const customCss = await readFile(join(root, 'client/styles.css'), 'utf8');
// Portals and focus surfaces now mount inside the workbench. A single scope
// keeps nested reading/dialog roots from resetting inherited dark tokens.
const scope = '.xuelearn-workbench';
const styles = postcss.parse(`${utility.css}\n${moduleCss}`);
// DSH's unlayered host CSS otherwise wins over Tailwind's layered utilities.
styles.walkAtRules('layer', rule => rule.nodes ? rule.replaceWith(rule.nodes) : rule.remove());
styles.walkRules(rule => {
  if (rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name)) return;
  rule.selector = rule.selector.replace(/:root\b|:host\b/g, ':scope')
    .replace(/(^|[\s,>+~(])(?:html|body)(?=[.#\[:\s,>+~)]|$)/g, '$1:scope')
    .replace(/\.dark(?=$|[\s,:)(])/g, ':scope.dark');
});
// Rem dimensions and breakpoints belong to Desktop's 16px baseline; DSH may
// choose a different document font size. Respond to the embedded surface too.
const dimensions = value => value.replace(/(-?\d*\.?\d+)rem\b/g, (_, number) => `${Number(number) * 16}px`)
  .replace(/(-?\d*\.?\d+)(?:dvh|vh)\b/g, (_, number) => `calc(var(--xuelearn-host-height, 100vh) * ${Number(number) / 100})`)
  .replace(/(-?\d*\.?\d+)(?:dvw|vw)\b/g, (_, number) => `calc(var(--xuelearn-host-width, 100vw) * ${Number(number) / 100})`);
styles.walkDecls(declaration => {declaration.value = dimensions(declaration.value);});
styles.walkAtRules('media', rule => {
  rule.params = rule.params.replace(/(-?\d*\.?\d+)rem\b/g, (_, number) => `${Number(number) * 16}px`);
  if (/(?:min-width|max-width|\bwidth\s*[<>])/.test(rule.params) && !/(?:prefers|hover|pointer|print|screen|orientation)/.test(rule.params)) {
    rule.name = 'container'; rule.params = `xuelearn ${rule.params}`;
  }
});
const globalRules = [];
styles.walkAtRules(rule => {
  if (rule.name === 'property' || rule.name === 'font-face' || /keyframes$/.test(rule.name)) {
    globalRules.push(rule.toString()); rule.remove();
  }
});
// KaTeX's stylesheet is inlined; its relative fonts must be bundled too.
let scopedStyles = styles.toString();
const publicAssets = new Map([...scopedStyles.matchAll(/url\((?:["']?)(\/[^)"']+)(?:["']?)\)/g)].map(match => [match[0], match[1]]));
for (const [url, asset] of publicAssets) {
  const path = join(desktop, 'public', asset);
  if (!statSync(path, {throwIfNoEntry: false})?.isFile()) continue;
  const bytes = await readFile(path);
  const mime = asset.endsWith('.svg') ? 'image/svg+xml' : asset.endsWith('.webp') ? 'image/webp' : 'image/png';
  scopedStyles = scopedStyles.replaceAll(url, `url(data:${mime};base64,${bytes.toString('base64')})`);
}
for (const match of [...scopedStyles.matchAll(/url\((?:["']?)(fonts\/[^)"']+)(?:["']?)\)/g)]) {
  const bytes = await readFile(join(dirname(requireDesktop.resolve('katex/dist/katex.min.css')), match[1]));
  const format = match[1].split('.').at(-1);
  scopedStyles = scopedStyles.replaceAll(match[0], `url(data:font/${format};base64,${bytes.toString('base64')})`);
}
const css = `${globalRules.join('\n')}\n@scope (${scope}) {\n${scopedStyles}\n}\n${customCss}`;
const generated = `window.__ModuleLoader__.load({id:"@xue-learn/dsh-plugin",factory(require){const module={exports:{}};const exports=module.exports;\n${js}\nconst plugin=module.exports;return {...plugin,apply(ctx){ctx.effect(()=>{const style=document.createElement('style');style.dataset.xuelearnDsh='';style.textContent=${JSON.stringify(css)};document.head.appendChild(style);return ()=>style.remove();});return plugin.apply(ctx);}};}});\n`;
await writeFile(join(output, 'client.js'), generated);
await writeFile(join(buildOutput, 'client.metafile.json'), JSON.stringify(bundle.metafile, null, 2));
await rm(join(output, 'client.metafile.json'), {force: true});
await writeFile(join(output, 'client.css'), css);
console.log(`DSH client built (${Math.round(generated.length / 1024)} KiB, React supplied by DSH)`);
