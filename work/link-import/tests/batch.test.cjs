'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {parseUrls,downloadBatch}=require('../LinkImport/lib/batch');
const a='https://youtu.be/GgeOkQ3ikgo',b='https://youtu.be/abcdefghijk';
test('Multiline links: trim blanks, normalize and deduplicate in input order',()=>{
 assert.deepEqual(parseUrls(' '+a+'\r\n\n'+b+'\n'+a+'#x'),[a,b]);
 assert.throws(()=>parseUrls(a+'\nnot-a-link'),/2번째 줄/);
 assert.throws(()=>parseUrls('   '));
 assert.throws(()=>parseUrls(Array.from({length:51},(_,i)=>a+'?x='+i).join('\n')),/50/);
});
test('Downloads run serially; failures do not discard successes or prevent next item',async()=>{
 let active=0,max=0,order=[];
 const engine={download:async(url)=>{active++;max=Math.max(max,active);order.push(url);await new Promise(r=>setImmediate(r));active--;if(url===b)throw Error('download failed');return {path:url};}};
 const r=await downloadBatch(engine,[a,b,a],'1080');
 assert.equal(max,1);assert.deepEqual(order,[a,b,a]);assert.deepEqual(r.results.map(i=>i.status),['downloaded','failed','downloaded']);
});
test('Cancellation stops remaining downloads even when engine resets its cancellation flag',async()=>{
 let stopped=false,calls=0;
 const engine={download:async()=>{calls++;stopped=true;throw Error('cancel');}};
 const r=await downloadBatch(engine,[a,b],'1080',{isCancelled:()=>stopped});
 assert.equal(calls,1);assert.equal(r.cancelled,true);assert.equal(r.pending,1);assert.equal(r.results[0].status,'cancelled');
});
test('Cancellation immediately after success preserves file and stops next item',async()=>{
 let stopped=false;
 const r=await downloadBatch({download:async()=>({path:'/a'})},[a,b],'1080',{isCancelled:()=>stopped,onItem:i=>{if(i.status==='downloaded')stopped=true;}});
 assert.equal(r.results.length,1);assert.equal(r.results[0].media.path,'/a');assert(r.cancelled);
});
function fixture({empty=false,failAt=null}={}){
 const items=[];items.numItems=0;const bin={name:'Link Import',type:2,children:items};const roots=[bin];roots.numItems=1;
 const project={path:'/project',rootItem:{children:roots},importFiles(files){const path=files[0];items.push({nodeId:path,type:1,getMediaPath:()=>path});items.numItems=items.length;return true;}};
 let inserts=0,created=0;
 function seq(id){const v=[],a=[];v.numItems=a.numItems=0;const vt=[{clips:v,isLocked:()=>false}],at=[{clips:a,isLocked:()=>false}];vt.numTracks=at.numTracks=1;
  return {sequenceID:id,videoTracks:vt,audioTracks:at,getPlayerPosition:()=>({seconds:10}),insertClip(item,time){
   inserts++;if(inserts===failAt)return;
   for(const list of [v,a]){for(const c of list){if(c.start.seconds>=time.seconds){c.start.seconds+=5;c.end.seconds+=5;}}
    list.push({projectItem:item,start:{seconds:time.seconds},end:{seconds:time.seconds+5}});list.sort((x,y)=>x.start.seconds-y.start.seconds);list.numItems=list.length;}
  }};
 }
 project.activeSequence=empty?null:seq('initial');
 project.createNewSequenceFromClips=(name,clips)=>{created++;const s=seq('new-'+created);project.activeSequence=s;s.insertClip(clips[0],{seconds:0});return s;};
 const context={app:{project},File:function(path){this.fsName=path;this.exists=true;},Time:function(){this.seconds=0;},encodeURIComponent,decodeURIComponent,Math,Date,Error,isFinite};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../LinkImport/host.jsx'),'utf8'),context);
 return {api:context.LinkImport,project,created:()=>created};
}
function run(f,mode){return f.api.importVideos(['/a','/b','/c'],[true,true,true],mode,'/project',f.project.activeSequence?'initial':'');}
function clips(f){return f.project.activeSequence.videoTracks[0].clips.map(c=>[c.projectItem.nodeId,c.start.seconds]);}
test('Batch append keeps input order',()=>{const f=fixture();assert.match(run(f,'append'),/^OK/);assert.deepEqual(clips(f),[['/a',0],['/b',5],['/c',10]]);});
test('Batch playhead inserts in input order at fixed playhead, with audio',()=>{const f=fixture();assert.match(run(f,'playhead'),/^OK/);assert.deepEqual(clips(f),[['/a',10],['/b',15],['/c',20]]);assert.equal(f.project.activeSequence.audioTracks[0].clips.length,3);});
test('New sequence mode creates exactly one sequence for the whole batch',()=>{const f=fixture();assert.match(run(f,'new'),/^OK/);assert.equal(f.created(),1);assert.deepEqual(clips(f),[['/a',0],['/b',5],['/c',10]]);});
test('No active sequence: playhead mode creates once then appends',()=>{const f=fixture({empty:true});assert.match(run(f,'playhead'),/^OK/);assert.equal(f.created(),1);assert.deepEqual(clips(f),[['/a',0],['/b',5],['/c',10]]);});
test('Changed context rejected before import and partial insertion stops batch',()=>{
 const f=fixture();assert.match(f.api.importVideos(['/a'],[true],'append','/other','initial'),/^ERR/);assert.equal(f.project.rootItem.children[0].children.length,0);
 assert.match(f.api.importVideos(['/a'],[true],'append','/project','changed'),/^ERR/);
 const g=fixture({failAt:2});assert.match(run(g,'append'),/^ERR/);assert.equal(clips(g).length,1);
});
test('Bin-only batch imports all files without timeline changes',()=>{const f=fixture();assert.match(run(f,'bin'),/^OK/);assert.deepEqual(clips(f),[]);assert.equal(f.project.rootItem.children[0].children.length,3);});
function panel(engine){
 const elements={};for(const id of ['download','local','update','url','quality','mode','cancel','items','status','result','progress','log','runtime'])elements[id]={value:'',disabled:false,textContent:'',addEventListener(event,fn){this.click=fn;}};
 elements.url.value=a+'\n'+b;elements.quality.value='1080';elements.mode.value='new';
 const scripts=[];const engineModule={Engine:function(){return engine;}};
 const context={document:{getElementById:id=>elements[id]},window:{__adobe_cep__:{getSystemPath:()=>'/extension',getHostEnvironment:()=>JSON.stringify({appName:'PPRO',appVersion:'26'}),evalScript(script,callback){scripts.push(script);callback(script==='LinkImport.prepare()'?'OK|%2Fproject|seq':'OK|Imported');}},cep_node:{require(name){if(name.endsWith('engine.js'))return engineModule;if(name.endsWith('batch.js'))return require('../LinkImport/lib/batch');return require(name);}},addEventListener(){}},Promise,JSON,Number,String,encodeURIComponent,decodeURIComponent,Error};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../LinkImport/main.js'),'utf8'),context);
 return {elements,scripts};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('Panel downloads both URLs before a single ordered batch import',async()=>{
 const calls=[];const p=panel({versions:async()=>'v',download:async(url)=>{calls.push(url);return {path:'/ready-'+calls.length+'.mp4',hasAudio:true};},cancel(){}});
 await settle();p.elements.download.click();await settle();
 assert.deepEqual(calls,[a,b]);assert.equal(p.scripts.length,2);assert.match(p.scripts[1],/importVideos\(\["%2Fready-1.mp4","%2Fready-2.mp4"\]/);assert.match(p.scripts[1],/"new"/);assert.equal(p.elements.download.disabled,false);
});
test('Panel cancel never imports even if completed download returns afterwards',async()=>{
 let finish;const p=panel({versions:async()=>'v',download:()=>new Promise(r=>{finish=r;}),cancel(){}});
 await settle();p.elements.download.click();await settle();p.elements.cancel.click();finish({path:'/ready.mp4',hasAudio:true});await settle();
 assert.deepEqual(p.scripts,['LinkImport.prepare()']);assert.match(p.elements.status.textContent,/취소/);
});
test('Panel retains failure detail and imports only successful downloads',async()=>{
 const p=panel({versions:async()=>'v',download:async(url)=>{if(url===a)throw Error('blocked');return {path:'/success.mp4',hasAudio:false};},cancel(){}});
 await settle();p.elements.download.click();await settle();assert.match(p.elements.items.textContent,/blocked/);assert.match(p.scripts[1],/\["%2Fsuccess.mp4"\],\[false\]/);assert.match(p.elements.status.textContent,/실패 1개/);
});
