import type {DisplayPluginManifest,DisplayPluginModule} from '../../../libs/display/src/types.js';
import {createDisplayCatalog} from '../../../libs/display/src/catalog.js';
import {createDisplayRuntime,type DisplayRuntimeOptions} from '../../../libs/display/src/runtime.js';
import type {DisplayRenderer} from '../display-runtime/index.js';
import {builtinDisplayManifests} from './catalog.js';
export * from './catalog.js';
export * from './adapters.js';

export async function loadBuiltinDisplayModule(manifest:DisplayPluginManifest):Promise<DisplayPluginModule<DisplayRenderer>> {
 const found=builtinDisplayManifests.find(item=>item.id===manifest.id&&item.version===manifest.version);
 if(!found)throw new Error(`No installed trusted display module ${manifest.id}@${manifest.version}`);
 switch(manifest.id.split('.').at(-1)){
  case 'general':return (await import('./renderers/general.js')).default;
  case 'math':return (await import('./renderers/math.js')).default;
  case 'music':return (await import('./renderers/music.js')).default;
  case 'physics':return (await import('./renderers/physics.js')).default;
  case 'computing':return (await import('./renderers/computing.js')).default;
  case 'media':return (await import('./renderers/media.js')).default;
  default:throw new Error(`No installed domain renderer for ${manifest.id}`);
 }
}
export function createBuiltinDisplayRuntime(options:Partial<DisplayRuntimeOptions<DisplayRenderer>>={}) {
 return createDisplayRuntime<DisplayRenderer>({catalog:createDisplayCatalog(builtinDisplayManifests),resolveModule:loadBuiltinDisplayModule,...options});
}
