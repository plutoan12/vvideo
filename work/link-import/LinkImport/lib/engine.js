'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),cp=require('child_process');
function validateUrl(raw){
 if(typeof raw!=='string'||raw.length>4096||/[\x00-\x20]/.test(raw.trim()))throw Error('영상 링크 한 개를 입력하세요.');
 let u;try{u=new URL(raw.trim());}catch(_){throw Error('올바른 영상 URL을 입력하세요.');}
 if(!['https:','http:'].includes(u.protocol)||u.username||u.password||u.port)throw Error('일반 http/https 영상 링크만 지원합니다.');
 let host=u.hostname.toLowerCase(),p=u.pathname;
 let yt=host==='youtu.be'? /^\/[\w-]{11}\/?$/.test(p):['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)&&((p==='/watch'&&/^[\w-]{11}$/.test(u.searchParams.get('v')||''))||/^\/(shorts|live|embed)\/[\w-]{11}\/?$/.test(p));
 let ig=['instagram.com','www.instagram.com'].includes(host)&&/^\/(p|reel|reels|tv)\/[\w-]+\/?$/.test(p);
 let tk=['www.tiktok.com','tiktok.com','m.tiktok.com'].includes(host)&&(/^\/@[^/]+\/video\/\d+\/?$/.test(p)||/^\/t\/[\w-]+\/?$/.test(p));
 tk=tk||['vm.tiktok.com','vt.tiktok.com'].includes(host)&&/^\/[\w-]+\/?$/.test(p);
 if(!yt&&!ig&&!tk)throw Error('YouTube·Instagram·TikTok의 개별 영상 링크를 입력하세요. 채널·프로필·재생목록은 지원하지 않습니다.');
 u.protocol='https:';u.hash='';return u.href;
}
function quality(v){if(!['1080','2160'].includes(String(v)))throw Error('해상도 설정이 올바르지 않습니다.');return Number(v);}
function downloadArgs(url,height,dir,bin){return ['--ignore-config','--no-plugin-dirs','--no-playlist','--playlist-items','1','--no-warnings','--newline','--no-color','--socket-timeout','30','--retries','2','--fragment-retries','2','--match-filters','!is_live & duration<=7200','--max-filesize','8G','--no-overwrites','--ffmpeg-location',bin,'--no-js-runtimes','--js-runtimes','deno:'+path.join(bin,'deno'),'-f','bv*[height<='+quality(height)+']+ba/b[height<='+quality(height)+']','--merge-output-format','mkv','--print','after_move:filepath','--progress','-o',path.join(dir,'source.%(ext)s'),'--',validateUrl(url)];}
class Engine{
 constructor(root,onLog){this.bin=path.join(root,'bin');this.log=onLog||function(){};this.child=null;this.cancelled=false;this.running=false;}
 cancel(){this.cancelled=true;if(this.child){const pid=this.child.pid;try{process.kill(-pid,'SIGTERM');}catch(_){}const timer=setTimeout(()=>{try{process.kill(-pid,'SIGKILL');}catch(_){}},2000);timer.unref();}}
 run(name,args,timeout){return new Promise((resolve,reject)=>{
  if(this.cancelled)return reject(Error('취소했습니다.'));
  const child=cp.spawn(path.join(this.bin,name),args,{shell:false,detached:true,windowsHide:true,stdio:['ignore','pipe','pipe']});this.child=child;
  let stdout='',tail='',expired=false;
  const timer=setTimeout(()=>{expired=true;this.cancel();},timeout||1800000);
  child.stdout.on('data',b=>{const t=b.toString();stdout=(stdout+t).slice(-1000000);this.log(t);});
  child.stderr.on('data',b=>{const t=b.toString();tail=(tail+t).slice(-4000);this.log(t);});
  child.on('error',()=>{clearTimeout(timer);this.child=null;reject(Error(name+' 실행 실패. 엔진 파일과 실행 권한을 확인하세요.'));});
  child.on('close',code=>{clearTimeout(timer);this.child=null;if(expired)return reject(Error('작업 제한 시간을 초과했습니다.'));if(this.cancelled)return reject(Error('취소했습니다. 일부 다운로드 파일은 보존됩니다.'));if(code!==0)return reject(Error(name+' 오류: '+tail.slice(-1500)));resolve(stdout);});
 });}
 async probe(file){const s=await this.run('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],30000);const d=JSON.parse(s);if(!d.streams.some(s=>s.codec_type==='video'))throw Error('영상 스트림이 없습니다.');return d;}
 async convert(input,dir,height){
  const info=await this.probe(input),v=info.streams.find(s=>s.codec_type==='video');
  const rate=/^\d+\/[1-9]\d*$/.test(v.avg_frame_rate||'')&&parseFloat(v.avg_frame_rate)>0?v.avg_frame_rate:'30';
  const out=path.join(dir,'ready.mp4');
  await this.run('ffmpeg',['-nostdin','-hide_banner','-loglevel','warning','-n','-i',input,'-map','0:v:0','-map','0:a:0?','-vf','scale=w=trunc(iw*min(1\\,'+quality(height)+'/ih)/2)*2:h=trunc(ih*min(1\\,'+quality(height)+'/ih)/2)*2','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-r',rate,'-fps_mode','cfr','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',out]);
  const check=await this.probe(out);if(fs.statSync(out).size<1000)throw Error('변환 파일이 비어 있습니다.');
  const hasAudio=info.streams.some(s=>s.codec_type==='audio');if(hasAudio&&!check.streams.some(s=>s.codec_type==='audio'))throw Error('오디오 변환 결과를 확인하지 못했습니다.');
  return {path:out,hasAudio:hasAudio,duration:Number(check.format.duration)};
 }
 async download(url,height){
  if(this.running)throw Error('작업이 이미 진행 중입니다.');this.running=true;this.cancelled=false;
  try{url=validateUrl(url);quality(height);const root=path.join(os.homedir(),'Downloads','LinkImport');fs.mkdirSync(root,{recursive:true});const dir=fs.mkdtempSync(path.join(root,'video-'));
   this.log('영상 다운로드 중…\n');const output=await this.run('yt-dlp',downloadArgs(url,height,dir,this.bin));
   let candidates=output.trim().split(/\r?\n/).filter(p=>path.dirname(p)===dir&&fs.existsSync(p)&&!p.endsWith('.part'));
   if(candidates.length!==1)throw Error('다운로드된 영상 파일을 확인하지 못했습니다. 영상이 비공개이거나 길이·용량 제한에 해당할 수 있습니다.');
   this.log('Premiere 호환 MP4로 변환 중…\n');return await this.convert(candidates[0],dir,height);
  }finally{this.running=false;}
 }
 async versions(){this.cancelled=false;const a=await this.run('yt-dlp',['--version'],15000);await this.run('ffmpeg',['-version'],15000);await this.run('ffprobe',['-version'],15000);await this.run('deno',['--version'],15000);return a.trim();}
 async update(){this.cancelled=false;return this.run('yt-dlp',['--ignore-config','--update'],120000);}
}
module.exports={Engine,validateUrl,quality,downloadArgs};
