var LinkImport = (function () {
 function reply(ok,text,extra){return (ok?'OK':'ERR')+'|'+encodeURIComponent(String(text))+'|'+encodeURIComponent(String(extra||''));}
 function projectKey(){if(!app.project||!app.project.path)throw Error('먼저 Premiere 프로젝트를 만들고 저장하세요.');return app.project.path;}
 function sequenceKey(){return app.project.activeSequence?String(app.project.activeSequence.sequenceID):'';}
 function countItem(seq,id,audio){var tracks=audio?seq.audioTracks:seq.videoTracks,n=0;for(var t=0;t<tracks.numTracks;t++){for(var i=0;i<tracks[t].clips.numItems;i++){var c=tracks[t].clips[i];if(c.projectItem&&c.projectItem.nodeId===id)n++;}}return n;}
 function findItem(bin,file){for(var i=0;i<bin.children.numItems;i++){var it=bin.children[i];if(it.type===2){var r=findItem(it,file);if(r)return r;}else{try{if(new File(it.getMediaPath()).fsName===file)return it;}catch(_){}}}return null;}
 function endSeconds(seq){var max=0,groups=[seq.videoTracks,seq.audioTracks];for(var g=0;g<groups.length;g++){for(var t=0;t<groups[g].numTracks;t++){var clips=groups[g][t].clips;for(var i=0;i<clips.numItems;i++)max=Math.max(max,clips[i].end.seconds);}}return max;}
 return {
  prepare:function(){try{return reply(true,projectKey(),sequenceKey());}catch(e){return reply(false,e.message);}},
  importVideo:function(encoded,mode,expectedProject,expectedSequence,hasAudio){
   try{
    var key=projectKey();if(key!==decodeURIComponent(expectedProject))throw Error('다운로드 중 프로젝트가 바뀌었습니다. 로컬 영상 가져오기로 다시 선택하세요.');
    if(mode!=='bin'&&sequenceKey()!==decodeURIComponent(expectedSequence))throw Error('다운로드 중 활성 시퀀스가 바뀌었습니다. 로컬 영상 가져오기로 다시 선택하세요.');
    if(mode!=='append'&&mode!=='playhead'&&mode!=='new'&&mode!=='bin')throw Error('배치 모드가 올바르지 않습니다.');
    var file=new File(decodeURIComponent(encoded));if(!file.exists)throw Error('다운로드 파일이 없습니다.');
    var seq=app.project.activeSequence;
    if(seq&&mode!=='new'&&mode!=='bin'){
     if(seq.videoTracks.numTracks<1||seq.audioTracks.numTracks<1)throw Error('V1/A1 트랙이 필요합니다.');
     if(seq.videoTracks[0].isLocked()||seq.audioTracks[0].isLocked())throw Error('V1/A1 잠금을 해제한 뒤 다시 가져오세요.');
    }
    var bin=null;for(var b=0;b<app.project.rootItem.children.numItems;b++){var x=app.project.rootItem.children[b];if(x.type===2&&x.name==='Link Import'){bin=x;break;}}
    if(!bin)bin=app.project.rootItem.createBin('Link Import');
    var item=findItem(bin,file.fsName);
    if(!item){var imported=app.project.importFiles([file.fsName],true,bin,false);if(!imported)throw Error('Premiere가 파일 가져오기를 거부했습니다.');item=findItem(bin,file.fsName);}
    if(!item)throw Error('프로젝트에서 가져온 클립을 찾지 못했습니다.');
    if(mode==='bin')return reply(true,'프로젝트의 Link Import 저장소에 가져왔습니다.',file.fsName);
    if(!seq||mode==='new'){
     seq=app.project.createNewSequenceFromClips('Link Import '+new Date().getTime(),[item],app.project.rootItem);
     if(!seq)seq=app.project.activeSequence;
     if(!seq||countItem(seq,item.nodeId,false)<1||(hasAudio&&countItem(seq,item.nodeId,true)<1))throw Error('파일은 가져왔지만 새 시퀀스의 영상·오디오 배치를 확인하지 못했습니다.');
     return reply(true,'새 시퀀스에 영상'+(hasAudio?'·오디오':'')+'를 배치했습니다.',file.fsName);
    }
    var beforeV=countItem(seq,item.nodeId,false),beforeA=countItem(seq,item.nodeId,true);
    var time=mode==='playhead'?seq.getPlayerPosition():new Time();if(mode==='append')time.seconds=endSeconds(seq);
    seq.insertClip(item,time,0,0);
    if(countItem(seq,item.nodeId,false)<=beforeV||(hasAudio&&countItem(seq,item.nodeId,true)<=beforeA))throw Error('파일은 가져왔지만 타임라인 배치를 확인하지 못했습니다. 프로젝트의 Link Import 저장소를 확인하세요.');
    return reply(true,(mode==='append'?'시퀀스 끝':'재생헤드 위치')+'에 영상'+(hasAudio?'·오디오':'')+'를 배치했습니다.',file.fsName);
   }catch(e){return reply(false,e.message);}
  }
 };
}());
