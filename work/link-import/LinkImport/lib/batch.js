'use strict';
const {validateUrl}=require('./engine');
function parseUrls(text){
 const lines=String(text).split(/\r?\n/),urls=[],seen=new Set();
 lines.forEach((line,i)=>{if(!line.trim())return;let url;try{url=validateUrl(line.trim());}catch(e){throw Error((i+1)+'번째 줄: '+e.message);}
  if(!seen.has(url)){seen.add(url);urls.push(url);}});
 if(!urls.length)throw Error('영상 링크를 한 줄에 하나씩 입력하세요.');
 if(urls.length>50)throw Error('한 번에 최대 50개 링크를 입력하세요.');
 return urls;
}
async function downloadBatch(engine,urls,quality,{isCancelled=()=>false,onItem=()=>{}}={}){
 const results=[];
 for(let index=0;index<urls.length;index++){
  if(isCancelled())break;
  const item={url:urls[index],index,status:'downloading'};results.push(item);onItem(item,urls.length);
  try{item.media=await engine.download(item.url,quality);item.status='downloaded';}
  catch(e){item.status=isCancelled()?'cancelled':'failed';item.error=e.message;}
  onItem(item,urls.length);
  if(isCancelled())break;
 }
 return {results,cancelled:isCancelled(),pending:urls.length-results.length};
}
module.exports={parseUrls,downloadBatch};
