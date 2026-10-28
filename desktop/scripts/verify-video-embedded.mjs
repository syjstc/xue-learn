import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {_electron} from 'playwright';
const require=createRequire(import.meta.url),root=resolve(import.meta.dirname,'..');
const bundle=resolve(process.argv[2]??'../xue-learn-video/release/video-plugin-0.2.0-darwin-arm64');
const output=resolve(process.argv[3]??'artifacts/video-embedded-2026-10-10');
const savedFixture=resolve(root,'../xue-learn-video/artifacts/embedded-plugin-export-final-2026-10-10');
const temporary=await mkdtemp(join(tmpdir(),'xuelearn-video-embedded-'));
await mkdir(output,{recursive:true});
const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG','LC_ALL','USERPROFILE','SystemRoot'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
Object.assign(env,{XUELEARN_DESKTOP_DATA_PATH:join(temporary,'desktop'),XUELEARN_DESKTOP_E2E_LOG_SIDECAR:'1'});
const logs=[],pageErrors=[],resourceErrors=[],consoleErrors=[];let application,page;
const report={status:'running',bundle,checks:[],scope:'Real Desktop host and packaged embedded Video, disposable learning workspace and synthetic catalog; no paid generation or user project changes.'};
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
 const href='/local/plugins/org.xuelearn.video/views/video.studio';await page.locator(`a[href="${href}"]`).click();
 await page.waitForSelector('.video-plugin-view',{timeout:90_000});
 await page.getByText('插件课程验收',{exact:true}).first().waitFor({timeout:60_000});
 report.checks.push('real package installs with host runtime and all declared capabilities','embedded studio reads a synthetic course from the real learning workspace');
 const after=await snapshot();assert.deepEqual(after.windows,before.windows);assert.deepEqual(after.processes.filter(p=>p.type==='Utility').map(p=>p.pid),before.processes.filter(p=>p.type==='Utility').map(p=>p.pid));
 report.processes={before,after};report.checks.push('no additional editor window or utility process');
 await page.screenshot({path:join(output,'video-library.png'),fullPage:true});
 // Exercise both category entry points and root links under the active host guard.
 await page.locator('.video-library-sidebar a').filter({hasText:'物理分类验收'}).click();
 await page.locator('.video-course-card').filter({hasText:'插件课程验收'}).waitFor();
 assert.equal(new URL(page.url()).pathname,href);
 await page.locator('.video-library-sidebar a').filter({hasText:'空间概览'}).click();
 await page.locator('.video-space-card').filter({hasText:'物理分类验收'}).waitFor();
 await page.locator('.video-library-sidebar a').filter({hasText:'全部课程'}).click();
 await page.locator('.video-course-card').filter({hasText:'插件课程验收'}).waitFor();
 await page.locator('.video-library-sidebar a').filter({hasText:'空间概览'}).click();
 await page.locator('.video-space-card').filter({hasText:'物理分类验收'}).click();
 await page.locator('.video-course-card').filter({hasText:'插件课程验收'}).waitFor();
 assert.equal(new URL(page.url()).pathname,href);
 report.checks.push('sidebar classification, space card, overview and all courses stay inside the plugin with active learning history');
 const link=await page.locator('link[data-desktop-plugin="org.xuelearn.video"]').getAttribute('href');
 const sessionId=new URL(link).pathname.split('/')[1];
 const settings=await page.evaluate(id=>window.xueLearnPlugins.callView(id,'generation.settings','get'),sessionId);assert(settings.global);
 const source=await page.evaluate(id=>window.xueLearnPlugins.callView(id,'workspace.courses','readUnit',{unitId:'video-smoke-unit'}),sessionId);assert.equal(source.metadata.title,'能量守恒');assert.equal(source.sections.length,1);
 report.checks.push('host generation settings and complete published course snapshot are available through declared capabilities');
 // Existing application commands run through direct native dispatch and short asynchronous job handles.
 const direct=async(method,path,body)=>{
  const {jobId}=await page.evaluate(({sessionId,method,path,body})=>window.xueLearnPlugins.executeView(sessionId,'video.request',{method,path,body}),{sessionId,method,path,body});
  for(let i=0;i<100;i++){
   const job=await page.evaluate(({sessionId,jobId})=>window.xueLearnPlugins.executeView(sessionId,'video.native',{operation:'request.poll',args:{jobId}}),{sessionId,jobId});
   if(job.state==='failed')throw Error(job.error);if(job.state==='complete')return job.response;
   await new Promise(resolve=>setTimeout(resolve,100));
  }throw Error('Video request did not complete');
 };
 const catalog=await direct('GET','/api/video/catalog');assert.equal(catalog.status,200);assert(catalog.body.some(item=>item.unitId==='video-smoke-unit'));
 const plugins=await direct('GET','/api/local/display-plugins');assert.equal(plugins.status,200);assert(Array.isArray(plugins.body));
 const queue=await page.evaluate(id=>window.xueLearnPlugins.executeView(id,'video.native',{operation:'videoProduction.list'}),sessionId);assert(Array.isArray(queue));
 report.checks.push('direct Video dispatcher, shared display catalog and persisted production queue respond without a Video HTTP server');
 // Follow the visible catalog drill-down into the saved synthetic project.
 if(await page.locator('.video-space-card').filter({hasText:'插件课程验收'}).count())await page.locator('.video-space-card').filter({hasText:'插件课程验收'}).click();
 await page.locator('.video-course-card').filter({hasText:'插件课程验收'}).click();
 await page.locator('.video-module-item').nth(1).click();
 await page.getByLabel('视频工作区导航').getByRole('link',{name:'视频队列',exact:true}).click();
 await page.locator('.video-library-layout').waitFor({state:'hidden'});
 assert.equal(new URL(page.url()).pathname,href);
 await page.getByLabel('视频工作区导航').getByRole('link',{name:'课程空间',exact:true}).click();
 await page.locator('.video-module-item.is-active').filter({hasText:'课程导览与独立课时'}).waitFor();
 assert.equal(new URL(page.url()).pathname,href);
 const unitLink=page.locator('.video-unit-link').filter({hasText:'能量守恒'});
 const unitHref=await unitLink.getAttribute('href');assert(unitHref.startsWith('/goals/video-smoke-goal/units/video-smoke-unit/lesson-performance?'));assert(unitHref.includes('renderBackend=remotion'));
 await unitLink.click();await page.locator('.video-plugin-view .lp-studio').waitFor({timeout:60_000});
 assert.equal(new URL(page.url()).pathname,href);
 await page.locator('.lp-studio-header h1').filter({hasText:'分配律：每一项从哪里来'}).waitFor({timeout:60_000});
 await page.locator('[data-remotion-stage="true"]').waitFor({timeout:60_000});
 await page.waitForFunction(()=>document.querySelector('[data-avatar-status="ready"]')&&!document.querySelector('[data-display-placeholder], [data-remotion-error="true"], [data-remotion-resource-status="error"]'),null,{timeout:60_000});
 const saved=await direct('GET','/api/local/lesson-performances/plugin-export-project');assert.equal(saved.status,200);assert.equal(saved.body.project.currentRevisionId,'plugin-export-revision');assert.equal(saved.body.script.scenes[0].id,'plugin_s1');assert.equal(saved.body.script.scenes[0].beats.length,4);
 const audio=await direct('GET','/api/local/lesson-performances/plugin-export-project/audio/plugin_s1_b1');assert.equal(audio.status,200);assert.equal(audio.encoding,'base64');assert(audio.body.length>100);
 const runtime=await page.evaluate(id=>window.xueLearnPlugins.executeView(id,'video.native',{operation:'runtime.initialize'}),sessionId);
 const audioDuration=await page.evaluate(url=>new Promise((resolve,reject)=>{const audio=new Audio();audio.onloadedmetadata=()=>{const duration=audio.duration;audio.removeAttribute('src');audio.load();resolve(duration);};audio.onerror=()=>reject(Error('Saved preview audio failed to load'));audio.src=url;}),runtime.assetBaseUrl+'/api/local/lesson-performances/plugin-export-project/audio/plugin_s1_b1');assert(audioDuration>0);
 // Seek into the existing derivation using the on-screen sentence navigation.
 const thirdBeat=page.getByRole('button',{name:/第 3 句：/});if(await thirdBeat.count())await thirdBeat.click();
 await page.screenshot({path:join(output,'video-unit-editor.png'),fullPage:true});
 report.checks.push('saved revision with four narration beats, playable audio and shared derivation preview loads in the embedded editor');
 await page.locator('.lp-studio select').filter({has:page.locator('option[value="cartesia"]')}).selectOption('cartesia');
 await page.waitForFunction(()=>{const select=[...document.querySelectorAll('.lp-studio select')].find(input=>[...input.options].some(option=>option.value==='cartesia'));return select?.value==='cartesia'&&!select.disabled;});
 const reread=await direct('GET','/api/local/lesson-performances/plugin-export-project');assert.equal(reread.body.ttsVoice,'cartesia');assert.equal(reread.body.project.currentRevisionId,'plugin-export-revision');
 const persisted=JSON.parse(execFileSync('python3',['-c','import sqlite3,json,sys;db=sqlite3.connect(sys.argv[1]);print(json.dumps({"revision":db.execute("SELECT currentRevisionId FROM LessonPerformanceProject WHERE id=?",("plugin-export-project",)).fetchone()[0],"count":db.execute("SELECT COUNT(*) FROM LessonPerformanceRevision").fetchone()[0]}))',videoDatabase],{encoding:'utf8'}));assert.equal(persisted.revision,'plugin-export-revision');assert.equal(persisted.count,1);
 report.checks.push('TTS preference edit persists through native dispatch while preserving accepted display narration and the original saved revision');
 // Exercise the new course-owned preparation/compilation path with already
 // published teaching. A host without provider credentials must still succeed.
 const courseBefore=await direct('GET','/api/video/sources/units/video-smoke-unit');assert.equal(courseBefore.status,200);
 const shared=await direct('POST','/api/local/lesson-performances/plugin-export-project/remotion/generate',{regenerate:true});assert.equal(shared.status,200,JSON.stringify(shared.body));
 assert.equal(shared.body.script.teachingSource,'course.v1');assert(shared.body.script.remotionLesson.scenes.some(scene=>scene.component.type==='display.v1'));
 assert(shared.body.script.remotionLesson.scenes.flatMap(scene=>scene.beats).some(beat=>beat.text==='总能量在转化过程中保持不变。'));
 const courseAfter=await direct('GET','/api/video/sources/units/video-smoke-unit');assert.equal(courseAfter.body.contentHash,courseBefore.body.contentHash);
 report.checks.push('real host learning.content prepares an existing course and compiles shared Remotion teaching without a model call or course rewrite');
 await page.locator('.lp-studio-heading a.lp-icon-button').click();await page.locator('.video-unit-link').filter({hasText:'能量守恒'}).waitFor();
 assert.equal(new URL(page.url()).pathname,href);
 report.checks.push('space, course and unit navigation opens the embedded Remotion editor and returns to the same course without changing the host route');
 await page.getByRole('link',{name:'生成设置',exact:true}).click();
 await page.getByRole('button',{name:'打开宿主模型与账号设置'}).waitFor();
 await page.screenshot({path:join(output,'video-host-settings.png'),fullPage:true});
 await page.getByRole('button',{name:'打开宿主模型与账号设置'}).click();
 await page.waitForURL(origin+'/local/api-keys');report.checks.push('Video settings navigate to the existing host model/account page');
 await page.goto(origin+'/local/plugins');await page.waitForSelector('#desktop-plugins-title');
 await page.evaluate(()=>window.xueLearnPlugins.disable('org.xuelearn.video'));
 assert.equal((await page.evaluate(()=>window.xueLearnDesktop.sidecar.getHealth())).status,'ready');
 await page.evaluate(()=>window.xueLearnPlugins.enable('org.xuelearn.video'));
 await page.locator(`a[href="${href}"]`).click();await page.waitForSelector('.video-plugin-view');
 await page.getByText('插件课程验收',{exact:true}).first().waitFor();
 await page.goto(origin+'/local/plugins');await page.evaluate(()=>window.xueLearnPlugins.disable('org.xuelearn.video'));
 report.checks.push('disable and re-enable preserve the learning service and reopen the embedded studio');
 assert.deepEqual(pageErrors,[]);assert.deepEqual(resourceErrors.filter(error=>error.error==='csp'),[]);report.status='passed';await rm(join(output,'failure.png'),{force:true});
}catch(error){report.status='failed';report.error=String(error);if(page){report.pageText=await page.locator('body').innerText().catch(()=>'<unavailable>');await page.screenshot({path:join(output,'failure.png'),fullPage:true}).catch(()=>{});}process.exitCode=1;}
finally{report.pageErrors=pageErrors;report.resourceErrors=resourceErrors;report.consoleErrors=consoleErrors;await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));await writeFile(join(output,'electron.log'),logs.join(''));await application?.close().catch(()=>{});await rm(temporary,{recursive:true,force:true});console.log(JSON.stringify(report,null,2));}
