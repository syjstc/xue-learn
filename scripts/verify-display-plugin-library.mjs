import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {_electron} from 'playwright';

const root=resolve(import.meta.dirname,'..'), require=createRequire(import.meta.url);
const output=join(root,'artifacts/display-plugin-library-2026-10-13');
const temporary=await mkdtemp(join(tmpdir(),'xuelearn-display-library-'));
const bundle=process.argv[2] ? resolve(process.argv[2]) : undefined;
await mkdir(output,{recursive:true});
const environment=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','USERPROFILE','SystemRoot'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(environment,{XUELEARN_DESKTOP_DATA_PATH:join(temporary,'desktop'),XUELEARN_DESKTOP_E2E_LOG_SIDECAR:'1'});
const report={status:'running',scope:'Disposable Electron profile, real Desktop/Display service, built Core and optionally embedded Video; no learner data or generation.',checks:[],errors:[]};
let app,page;
try{
  app=await _electron.launch({executablePath:require('electron'),args:[join(root,'apps/desktop')],env:environment,timeout:60000});
  page=await app.firstWindow({timeout:60000});
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForURL('http://127.0.0.1:*/**',{timeout:90000});
  await page.setViewportSize({width:1440,height:1080});
  const origin=new URL(page.url()).origin;
  await page.goto(origin+'/local/plugins');
  await page.getByRole('link',{name:'打开插件库与预览',exact:true}).click();
  await page.waitForSelector('.display-plugin-card');
  assert.equal(await page.locator('.display-plugin-card').count(),6);
  assert((await page.locator('body').innerText()).includes('27 个组件'));
  const settle=async()=>{await page.waitForFunction(()=>!document.querySelector('[data-display-placeholder="loading"]'));await page.evaluate(async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);});};
  await settle();
  assert.equal(await page.locator('[data-display-placeholder]').count(),0);
  await page.screenshot({path:join(output,'desktop-library.png'),fullPage:true});
  await page.getByRole('button',{name:'运动场景',exact:true}).click();await settle();
  assert(page.url().includes('component=physics%3Amotion-scene'));
  await page.getByRole('button',{name:'下一个组件',exact:true}).click();await settle();
  assert(page.url().includes('component=physics%3Aocclusion-lab'));
  await page.reload();await settle();
  await page.waitForSelector('[data-display-artwork="physics:occlusion-lab"]');
  await page.goBack();await settle();
  assert(page.url().includes('component=physics%3Amotion-scene'));
  await page.screenshot({path:join(output,'desktop-motion-preview.png'),fullPage:true});
  report.checks.push('native plugin-manager entry and authenticated 6-package/27-component catalog','actual Electron CSP and lazy renderer resources','versioned URL selection survives reload and browser history');
  for(const kind of ['math:derivation','music:teaching','computing:evaluation-lab','media:lottie']){
    const domain=kind.split(':')[0];
    await page.goto(origin+'/local/display-plugins?plugin=org.xuelearn.display.'+domain+'&version=1.0.0&component='+encodeURIComponent(kind)+'&componentVersion=1');
    await page.waitForSelector('.display-plugin-player');await settle();
    assert.equal(await page.locator('[data-display-placeholder]').count(),0,kind);
  }
  report.checks.push('derivation, musical teaching, evaluation and motion graphics render inside Desktop');
  await page.getByRole('button',{name:'从头预览'}).click();
  await page.getByRole('button',{name:'播放预览'}).click();
  await page.waitForFunction(()=>Number(document.querySelector('.display-plugin-player [data-display-frame]')?.dataset.displayFrame)>10);
  await page.getByRole('button',{name:'暂停预览'}).click();
  report.checks.push('player advances and pauses in Electron');
  if(bundle){
    const manifest=JSON.parse(await readFile(join(bundle,'plugin.json'),'utf8'));
    await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},bundle);
    await page.evaluate(()=>window.xueLearnPlugins.install());
    await page.evaluate(id=>window.xueLearnPlugins.enable(id),manifest.id);
    const view=manifest.contributes.views[0];
    await page.goto(origin+'/local/plugins/'+manifest.id+'/views/'+view.id);
    await page.waitForSelector('.video-studio-nav');
    await page.locator('.video-studio-nav').getByRole('link',{name:'插件预览',exact:true}).click();
    await page.getByRole('button',{name:'打开插件库与预览',exact:true}).click();
    await page.waitForURL('**/local/display-plugins');
    await page.waitForSelector('.display-plugin-card');await settle();
    assert.equal(await page.locator('.display-plugin-card').count(),6);
    assert.equal(await page.locator('[data-display-placeholder]').count(),0);
    report.videoVersion=manifest.version;
    report.checks.push('embedded Video navigation opens the host Display preview library');
    await page.screenshot({path:join(output,'video-to-host-library.png'),fullPage:true});
  }
  assert.deepEqual(report.errors,[]);
  report.status='passed';console.log(JSON.stringify(report,null,2));
}catch(error){report.status='failed';report.error=String(error);if(page){report.url=page.url();report.text=(await page.locator('body').innerText().catch(()=>'' )).slice(-10000);await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});}throw error;}
finally{if(app)await app.close();await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await rm(temporary,{recursive:true,force:true});}
