import {cpSync, rmSync} from 'node:fs';
import {join} from 'node:path';

/** Non-code resources that Desktop's app packaging normally adds to its service. */
export function stageRuntimeResources({coreRoot, output}) {
  const skills = join(output, 'teaching-skills');
  rmSync(skills, {recursive: true, force: true});
  cpSync(join(coreRoot, 'sources/libs/server/src/teaching-skills/builtin'), join(skills, 'builtin'), {
    recursive: true, dereference: true,
  });

  // This host renders reading and SVG in DSH's browser, using its system fonts.
  // The optional server-side vision preview and PDF export are not exposed here.
  rmSync(join(output, 'fonts'), {recursive: true, force: true});
}
