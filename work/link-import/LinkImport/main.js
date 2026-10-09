(function(){'use strict';
var $=function(id){return document.getElementById(id);},bridge=window.__adobe_cep__,engine,root,path,fs,busy=false,ready=false,log='',batchModule,batchCancelled=false,batchLabel='';
function write(t){log=(log+t).slice(-16000);$('log').textContent=log;var m=t.match(/\[download\]\s+([\d.]+)%/);if(m)$('progress').value=Number(m[1]);if(t.indexOf('변환 중')>=0)$('status').textContent=batchLabel+'다운로드 완료 · 편집용 MP4로 변환 중…';}
function controls(value){busy=value;['download','local','update','url','quality','mode'].forEach(function(id){$(id).disabled=value||!ready;});$('cancel').disabled=!value;}
function host(script){return new Promise(function(resolve,reject){bridge.evalScript(script,function(s){var a=String(s).split('|');if(a[0]!=='OK'){reject(Error(a[0]==='ERR'?decodeURIComponent(a[1]):'Premiere 응답을 확인하지 못했습니다.'));return;}resolve({text:decodeURIComponent(a[1]),extra:decodeURIComponent(a[2]||'')});});});}
function arg(s){return JSON.stringify(encodeURIComponent(s));}
async function insert(media,context,mode){$('result').textContent=media.path;$('status').textContent='Premiere에 가져오는 중…';$('cancel').disabled=true;var result=await host('LinkImport.importVideo('+[arg(media.path),JSON.stringify(mode),arg(context.text),arg(context.extra),media.hasAudio?'true':'false'].join(',')+')');$('status').textContent=result.text;$('result').textContent=media.path;$('progress').value=100;}
async function action(fn){if(busy)return;controls(true);batchCancelled=false;batchLabel='';$('items').textContent='';log='';$('log').textContent='';$('result').textContent='';$('progress').value=0;try{await fn();}catch(e){$('status').textContent=e.message||'작업을 완료하지 못했습니다.';}finally{controls(false);}}
$('download').addEventListener('click',function(){action(async function(){
 var urls=batchModule.parseUrls($('url').value),q=$('quality').value,mode=$('mode').value;
 var context=await host('LinkImport.prepare()'),items=[];
 var report=await batchModule.downloadBatch(engine,urls,q,{isCancelled:function(){return batchCancelled;},onItem:function(item,total){
  batchLabel='['+(item.index+1)+'/'+total+'] ';
  if(item.status==='downloading'){$('progress').value=0;$('status').textContent=batchLabel+'영상 다운로드 중…';}
  var state={downloading:'다운로드 중',downloaded:'다운로드 완료',failed:'실패',cancelled:'취소'}[item.status];
  items[item.index]=(item.index+1)+'. '+state+' · '+item.url+(item.error?'\n'+item.error:'')+(item.media?'\n'+item.media.path:'');
  $('items').textContent=items.join('\n\n');
 }});
 var downloaded=report.results.filter(function(item){return item.status==='downloaded';});
 var failed=report.results.filter(function(item){return item.status==='failed';}).length;
 if(report.cancelled){$('status').textContent='취소했습니다. 다운로드 완료 '+downloaded.length+'개는 보관되며 Premiere에는 가져오지 않았습니다.';return;}
 if(!downloaded.length)throw Error('가져올 영상이 없습니다. 각 링크의 실패 내용을 확인하세요.');
 $('cancel').disabled=true;$('status').textContent=downloaded.length+'개 영상을 Premiere에 가져오는 중…';
 var paths='['+downloaded.map(function(item){return arg(item.media.path);}).join(',')+']';
 var audios=JSON.stringify(downloaded.map(function(item){return item.media.hasAudio;}));
 var result=await host('LinkImport.importVideos('+[paths,audios,JSON.stringify(mode),arg(context.text),arg(context.extra)].join(',')+')');
 $('status').textContent=result.text+(failed?' · 다운로드 실패 '+failed+'개':'');$('progress').value=100;
 $('result').textContent=downloaded.map(function(item){return item.media.path;}).join('\n');
});});
$('local').addEventListener('click',function(){action(async function(){var context=await host('LinkImport.prepare()'),mode=$('mode').value;var d=window.cep.fs.showOpenDialogEx(false,false,'가져올 영상 선택','',['mp4','mov','mkv','m4v','webm'],'','가져오기');if(d.err)throw Error('파일 선택 창을 열지 못했습니다.');if(!d.data||!d.data[0])return;engine.cancelled=false;var info=await engine.probe(d.data[0]);await insert({path:d.data[0],hasAudio:info.streams.some(function(s){return s.codec_type==='audio';})},context,mode);});});
$('cancel').addEventListener('click',function(){batchCancelled=true;engine.cancel();$('status').textContent='취소 중…';$('cancel').disabled=true;});
$('update').addEventListener('click',function(){action(async function(){$('status').textContent='yt-dlp 공식 배포판으로 업데이트 중…';await engine.update();$('status').textContent='엔진 업데이트 확인 완료';});});
window.addEventListener('beforeunload',function(){if(engine&&busy)engine.cancel();});
var engineModule;
(async function(){try{var req=window.cep_node&&window.cep_node.require;if(!req&&typeof require==='function')req=require;if(!bridge||!req)throw Error('Premiere의 창 → 확장명에서 Link Import를 열어 주세요.');path=req('path');fs=req('fs');root=bridge.getSystemPath('extension');if(/^file:/i.test(root))root=req('url').fileURLToPath(root);engineModule=req(path.join(root,'lib','engine.js'));batchModule=req(path.join(root,'lib','batch.js'));engine=new engineModule.Engine(root,write);var version=await engine.versions();var hostInfo=JSON.parse(bridge.getHostEnvironment());if(hostInfo.appName!=='PPRO')throw Error('Premiere Pro에서 실행해 주세요.');$('runtime').textContent='Premiere '+hostInfo.appVersion+' · yt-dlp '+version;ready=true;controls(false);$('status').textContent='준비 완료 · 영상 링크를 입력하세요.';log='';$('log').textContent='';}catch(e){$('status').textContent=e.message;}}());
}());
