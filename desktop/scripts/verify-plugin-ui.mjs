import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {_electron} from 'playwright';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const bundle=resolve(process.argv[2]??'../xue-learn-video/release/video-plugin-0.2.11-darwin-arm64-ui-final');
const output=resolve(process.argv[3]??'artifacts/plugin-ui-2026-10-13');
const savedFixture=resolve(root,'../xue-learn-video/artifacts/embedded-plugin-export-final-2026-10-10');
const temporary=await mkdtemp(join(tmpdir(),'xuelearn-video-embedded-'));
await mkdir(output,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','USERPROFILE','SystemRoot'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{XUELEARN_DESKTOP_DATA_PATH:join(temporary,'desktop'),XUELEARN_DESKTOP_E2E_LOG_SIDECAR:'1'});
const logs=[],pageErrors=[],resourceErrors=[],consoleErrors=[];let application,page;
const report={status:'running',bundle,checks:[],scope:'Real Desktop host, packaged Video 0.2.11 and a disposable seeded workspace with a fictitious local Ollama embedding selection. No model downloads, paid generation or user project changes.'};
try{
 application=await _electron.launch({executablePath:require('electron'),args:[join(root,'apps/desktop')],env,timeout:60_000});
 application.process().stderr.on('data',chunk=>logs.push(chunk.toString()));
 page=await application.firstWindow({timeout:60_000});page.on('pageerror',error=>pageErrors.push(error.message));
 page.on('requestfailed',request=>resourceErrors.push({url:request.url(),error:request.failure()?.errorText}));
 page.on('response',response=>{if(response.status()>=400)resourceErrors.push({url:response.url(),status:response.status()});});
 page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
 await page.waitForURL('http://127.0.0.1:*/**',{timeout:90_000});const origin=new URL(page.url()).origin;
 await page.goto(origin+'/local/plugins');await page.waitForSelector('#desktop-plugins-title');
 const workspaces=await page.evaluate(()=>window.xueLearnDesktop.workspaces.list());
 const active=workspaces.find(item=>item.active);assert(active);
 await page.waitForFunction(()=>sessionStorage.getItem('xuelearn.learning-session.v1'));
 const learningSessionId=await page.evaluate(()=>sessionStorage.getItem('xuelearn.learning-session.v1'));
 // Seed only this newly-created test database, using its real migrated schema.
 const database=join(temporary,'desktop','workspaces',active.workspaceId,'xuelearn-local-v2.sqlite3');
 const seed=String.raw`import sqlite3,sys,datetime,json,hashlib
from pathlib import Path
p=Path(sys.argv[1]);assert p.exists(),p
db=sqlite3.connect(p);now=datetime.datetime.now(datetime.timezone.utc).isoformat()
def insert(table,values):
 for _,name,type_,required,default,pk in db.execute('PRAGMA table_info("'+table+'")'):
  if name in values or not required or default is not None:continue
  values[name]=now if name.endswith('At') else 0 if any(n in type_.upper() for n in ['INT','REAL','BOOL']) else ''
 names=list(values);db.execute('INSERT INTO "'+table+'" ('+','.join('"'+x+'"' for x in names)+') VALUES ('+','.join('?' for _ in names)+')',[values[x] for x in names])
insert('LearningGoal',dict(id='video-smoke-goal',userId='local-owner-v1',title='插件课程验收',goalKind='micro',contentLanguage='zh',status='active'))
insert('LearningSpace',dict(id='video-smoke-space',userId='local-owner-v1',name='物理分类验收',normalizedName='物理分类验收',purpose='验证插件内分类导航'))
insert('LearningSpaceItem',dict(id='video-smoke-space-item',spaceId='video-smoke-space',goalId='video-smoke-goal',itemType='goal'))
insert('LearningUnit',dict(id='video-smoke-unit',goalId='video-smoke-goal',moduleId=None,title='能量守恒',unitKind='overview',contentSummary='能量守恒基础',contentRevision=1,orderIndex=0))
insert('UnitSection',dict(id='video-smoke-section',unitId='video-smoke-unit',title='能量的转化',orderIndex=0,contentKind='standard',generationStatus='ready',testGenerationStatus='ready',contentRevision=1,assessmentAfter=0))
insert('UnitSectionMaterial',dict(id='video-smoke-material',sectionId='video-smoke-section',introduction='能量可以转化。',blocks=json.dumps([dict(type='paragraph',text='总能量在转化过程中保持不变。')]),keyTakeaways=json.dumps(['能量守恒'])))
# Reproduce the user's established learning session: an empty workspace would
# skip the host's document-capture navigation guard and hide this regression.
session=sys.argv[2]
activity=dict(id='video-smoke-activity',sessionId=session,goalId='video-smoke-goal',unitId='video-smoke-unit',kind='lesson',state='active',revision=1,createdAt=now,updatedAt=now,position=dict(version=1,unitId='video-smoke-unit',mode='reading'))
insert('LearningActivity',dict(id=activity['id'],userId='local-owner-v1',goalId=activity['goalId'],sessionId=session,payload=json.dumps(activity),updatedAt=now))
focusId=hashlib.sha256(json.dumps(['local-owner-v1',session],separators=(',',':')).encode()).hexdigest()
insert('LearningFocus',dict(id=focusId,userId='local-owner-v1',sessionId=session,activityId=activity['id'],revision=1))
db.commit();db.close()`;
 execFileSync('python3',['-c',seed,database,learningSessionId]);
 const [mainlineResponse]=await Promise.all([
  page.waitForResponse(response=>new URL(response.url()).pathname==='/api/learning-trajectory/mainline'&&response.ok()),
  page.reload(),
 ]);
 assert.equal((await mainlineResponse.json()).focus.activityId,'video-smoke-activity');
 await page.waitForSelector('#desktop-plugins-title');
 report.checks.push('host has an active persisted learning activity before plugin navigation');
 const snapshot=()=>application.evaluate(({app,BrowserWindow})=>({windows:BrowserWindow.getAllWindows().map(w=>w.id),processes:app.getAppMetrics().map(({pid,type})=>({pid,type}))}));
 const before=await snapshot();assert.equal(before.windows.length,1);
 await application.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},bundle);
 await page.evaluate(()=>window.xueLearnPlugins.install());
 const installed=(await page.evaluate(()=>window.xueLearnPlugins.list())).find(item=>item.manifest.id==='org.xuelearn.video');
 assert.deepEqual(installed.missingCapabilities,[]);assert.equal(installed.manifest.runtime.mode,'host');
 // Copy already-rendered, synthetic Video work into this disposable workspace.
 // sqlite backup includes any checkpointed journal without carrying old output paths.
 const seedVideo=String.raw`import sqlite3,sys,json,hashlib,shutil
from pathlib import Path
fixture=Path(sys.argv[1]);workspace=sys.argv[3];target=Path(sys.argv[2])/'workspaces'/hashlib.sha256(workspace.encode()).hexdigest();target.mkdir(parents=True,exist_ok=True)
source=next((fixture/'plugin-data'/'workspaces').glob('*/video.sqlite'));original=sqlite3.connect(source);db=sqlite3.connect(target/'video.sqlite');original.backup(db);original.close()
mapping={'plugin-export-owner':'local-owner-v1','plugin-export-unit':'video-smoke-unit','plugin-export-goal':'video-smoke-goal','plugin-export-workspace':workspace}
def rewrite(value):
 if isinstance(value,str):return mapping.get(value,value)
 if isinstance(value,list):return [rewrite(v) for v in value]
 if isinstance(value,dict):return {k:rewrite(v) for k,v in value.items()}
 return value
db.execute('UPDATE LessonPerformanceProject SET userId=?,unitId=?,goalId=?',('local-owner-v1','video-smoke-unit','video-smoke-goal'))
for table,column in [('LessonPerformanceProject','sourceSnapshotJson'),('LessonPerformanceRevision','scriptJson')]:
 for id,value in db.execute('SELECT id,'+column+' FROM '+table).fetchall():db.execute('UPDATE '+table+' SET '+column+'=? WHERE id=?',(json.dumps(rewrite(json.loads(value))),id))
db.execute('UPDATE VideoWorkspaceBinding SET sourceWorkspaceId=?',(workspace,));db.execute('DELETE FROM VideoSourceSnapshot');db.execute('DELETE FROM LessonPerformanceExport');db.commit();db.close()
shutil.copytree(source.parent/'audio',target/'audio',dirs_exist_ok=True)
print(str(target/'video.sqlite'))`;
 const videoDatabase=execFileSync('python3',['-c',seedVideo,savedFixture,join(temporary,'desktop','plugins','data','org.xuelearn.video'),active.workspaceId],{encoding:'utf8'}).trim();
 await page.evaluate(()=>window.xueLearnPlugins.enable('org.xuelearn.video'));

 const unitPath='/goals/video-smoke-goal/units/video-smoke-unit?section=video-smoke-section#beat-2';
 const bodyAction=()=>page.locator('[data-desktop-plugin-slot="unit.content.actions"] a');
 const hostRequest=async(method,path,body)=>page.evaluate(async({method,path,body})=>{
  const response=await fetch(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  if(!response.ok)throw Error(await response.text());return response.json();
 },{method,path,body});
 await hostRequest('PATCH','/api/local/ai-models',{capability:'embedding',providerId:'ollama',model:'ui-fixture'});
 for(const mode of ['reading','chat']){
  await hostRequest('PATCH','/api/settings/learning-view',{mode,chatAudioEnabled:false});
  await page.goto(origin+unitPath);
  await bodyAction().waitFor({timeout:30_000});
  assert.equal(await bodyAction().innerText(),'查看课时视频');
  const actionHref=await bodyAction().getAttribute('href');
  const launch=new URL(actionHref,origin);
  assert.equal(launch.searchParams.get('pluginPath'),'/goals/video-smoke-goal/units/video-smoke-unit/lesson-performance?renderBackend=remotion');
  assert.equal(launch.searchParams.get('returnTo'),unitPath);
  assert.equal(launch.searchParams.get('unitId'),'video-smoke-unit');
  await page.screenshot({path:join(output,`body-action-${mode}.png`),fullPage:true});
  report.checks.push(`lesson body action renders in ${mode} mode with current goal/unit and complete return position`);
 }
 // Immersive mode moves the lesson subtree to a portal; registry context must survive.
 const enter=page.locator('[data-desktop-immersive-enter]').first();
 if(await enter.count()){
  await enter.click();await bodyAction().waitFor();
  await page.screenshot({path:join(output,'body-action-immersive.png'),fullPage:true});
  await page.locator('[data-desktop-immersive-controls] button').click();
  report.checks.push('body action remains available inside the immersive portal');
 }
 await bodyAction().click();
 await page.waitForURL(url=>url.pathname==='/local/plugins/org.xuelearn.video/views/video.studio');
 await page.waitForSelector('.lp-studio',{timeout:30_000});
 await page.getByText('查看课时视频',{exact:true}).waitFor({state:'detached'});
 assert.equal(await page.locator('.video-library').count(),0);
 await page.screenshot({path:join(output,'contextual-studio.png'),fullPage:true});
 report.checks.push('body action opens the saved current lesson directly in the embedded Remotion studio');
 await page.getByRole('link',{name:'返回学习正文',exact:true}).click();
 await page.waitForURL(origin+unitPath);await bodyAction().waitFor();
 report.checks.push('return action restores the original lesson, section and fragment');
 const settingsPath='/settings?tab=plugin%3Aorg.xuelearn.video%3Avideo.settings';
 await page.goto(origin+settingsPath);
 await page.getByRole('heading',{name:'视频导出',exact:true}).waitFor({timeout:30_000});
 assert.equal(new URL(page.url()).searchParams.get('tab'),'plugin:org.xuelearn.video:video.settings');
 assert.equal(await page.locator('.video-studio-nav').count(),0);
 const navLinks=page.locator(`a[href="${settingsPath}"]`);assert(await navLinks.count()>0);
 const workers=page.getByRole('combobox',{name:'渲染并行数',exact:true});
 await workers.selectOption('2');
 await page.waitForFunction(()=>{const field=document.querySelector('select[aria-label="渲染并行数"]');return field?.value==='2'&&!field.disabled;});
 await page.getByRole('checkbox',{name:'在视频中显示讲解字幕'}).click();
 await page.waitForFunction(()=>{const field=document.querySelector('.video-plugin-view input[type="checkbox"]');return field?.checked&&!field.disabled;});
 await page.reload();
 await page.getByRole('heading',{name:'视频导出',exact:true}).waitFor();
 await workers.waitFor();assert.equal(await workers.inputValue(),'2');
 assert(await page.getByRole('checkbox',{name:'在视频中显示讲解字幕'}).isChecked());
 await page.screenshot({path:join(output,'video-settings-tab.png'),fullPage:true});
 report.checks.push('a direct plugin settings deep link survives registry startup and browser reload', 'Video export concurrency and subtitles persist through native commands in the same workspace');
 await page.setViewportSize({width:650,height:1000});
 const mobileTab=page.locator('button[aria-current="page"]').filter({hasText:/^视频$/});
 await mobileTab.waitFor();await page.screenshot({path:join(output,'video-settings-mobile.png'),fullPage:true});
 report.checks.push('plugin settings appear in mobile settings navigation');
 await page.setViewportSize({width:1280,height:900});
 const styleUrl=await page.locator('link[data-desktop-plugin="org.xuelearn.video"]').getAttribute('href');
 const sessionId=new URL(styleUrl).pathname.split('/')[1];
 await page.evaluate(()=>window.xueLearnPlugins.disable('org.xuelearn.video'));
 await page.waitForURL(origin+'/settings');
 assert.equal(await page.locator('.video-plugin-view').count(),0);
 assert.equal(await page.locator(`a[href="${settingsPath}"]`).count(),0);
 assert.equal(await page.locator('link[data-desktop-plugin="org.xuelearn.video"]').count(),0);
 const closed=await page.evaluate(id=>window.xueLearnPlugins.callView(id,'workspace.courses','catalog').then(()=>false,()=>true),sessionId);
 assert(closed);
 await page.goto(origin+unitPath);
 await page.waitForSelector('h1');
 assert.equal(await bodyAction().count(),0);
 report.checks.push('disable removes body/settings placements, disposes CSS/session and safely returns settings to the profile tab');
 await page.evaluate(()=>window.xueLearnPlugins.enable('org.xuelearn.video'));
 await bodyAction().waitFor();
 const after=await snapshot();assert.deepEqual(after.windows,before.windows);
 assert.deepEqual(after.processes.filter(p=>p.type==='Utility').map(p=>p.pid),before.processes.filter(p=>p.type==='Utility').map(p=>p.pid));
 report.processes={before,after};
 report.checks.push('re-enable restores placements without an additional editor window or utility process');
 assert.deepEqual(pageErrors,[]);report.status='passed';await rm(join(output,'failure.png'),{force:true});
}catch(error){report.status='failed';report.error=String(error);if(page){report.pageText=await page.locator('body').innerText().catch(()=>'<unavailable>');await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{report.pageErrors=pageErrors;report.resourceErrors=resourceErrors;report.consoleErrors=consoleErrors;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(output,'electron.log'),logs.join(''));await application?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true});console.log(JSON.stringify(report,null,2));}
