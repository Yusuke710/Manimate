import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {LOCAL_ROOT,ensureLocalSessionLayout} from './config';
import {createLocalSession,getLocalSession,updateLocalSession} from './session-store';
import {DEFAULT_MODEL,isAspectRatio} from '../models';

const pending=new Map<string,Promise<string>>();
export function openSharedSession(token:string):Promise<string>{
  if(!/^[a-zA-Z0-9_-]{1,160}$/.test(token))return Promise.reject(new Error('Invalid share link.'));
  const existing=pending.get(token);if(existing)return existing;
  const task=importSharedSession(token).finally(()=>pending.delete(token));pending.set(token,task);return task;
}
async function boundedText(response:Response,limit:number){
  if(!response.body)throw Error('The shared project is empty.');
  const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('The shared project is too large.');chunks.push(value);}}finally{await reader.cancel();}
  return Buffer.concat(chunks).toString('utf8');
}
async function importSharedSession(token:string):Promise<string>{
  const response=await fetch(`https://manimate.ai/share/${token}/handoff`,{signal:AbortSignal.timeout(60000),redirect:'error'});
  if(!response.ok)throw Error('This shared project is unavailable.');
  const data=JSON.parse(await boundedText(response,12_000_000));
  const sourceId=typeof data.source_session_id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(data.source_session_id)?data.source_session_id:null;
  if(sourceId&&getLocalSession(sourceId))return sourceId;
  const folder=path.join(LOCAL_ROOT,'shared-handoffs');await fs.mkdir(folder,{recursive:true});
  const record=path.join(folder,createHash('sha256').update(token).digest('hex')+'.json');
  const previous=JSON.parse(await fs.readFile(record,'utf8').catch(()=>'{}'));
  if(typeof previous.session_id==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(previous.session_id)&&getLocalSession(previous.session_id))return previous.session_id;
  const staging=await fs.mkdtemp(path.join(folder,'import-'));
  try{
    const script=typeof data.script_content==='string'?data.script_content:null;
    const subtitles=typeof data.subtitles_content==='string'?data.subtitles_content:null;
    if(!script&&!data.video_url)throw Error('This link has no editable project or video.');
    if(script)await fs.writeFile(path.join(staging,'script.py'),script);
    if(subtitles)await fs.writeFile(path.join(staging,'subtitles.srt'),subtitles);
    let hasVideo=false;
    if(data.video_url){
      const url=new URL(data.video_url);
      if(url.origin!=='https://manimate.ai'||!/^\/(media|files)\//.test(url.pathname))throw Error('Invalid shared video address.');
      const video=await fetch(url,{signal:AbortSignal.timeout(180000),redirect:'error'});
      if(!video.ok||!video.body)throw Error('Could not download the shared video.');
      const reader=video.body.getReader(),file=await fs.open(path.join(staging,'video.mp4'),'w');let size=0;
      try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>500_000_000)throw Error('The shared video is too large.');await file.write(value);}}finally{await reader.cancel();await file.close();}
      hasVideo=true;
    }
    const session=createLocalSession({model:DEFAULT_MODEL,aspect_ratio:isAspectRatio(data.aspect_ratio)?data.aspect_ratio:null});
    const {projectDir}=ensureLocalSessionLayout(session.id,{model:session.model});
    for(const name of await fs.readdir(staging))await fs.rename(path.join(staging,name),path.join(projectDir,name));
    let chapters=data.chapters;if(typeof chapters==='string'){try{chapters=JSON.parse(chapters);}catch{chapters=null;}}
    updateLocalSession(session.id,{title:`Handoff: ${String(data.title||'Shared animation').replace(/^(Handoff:\s*)+/i,'').slice(0,200)}`,...(hasVideo?{video_path:path.join(projectDir,'video.mp4')}:{}),chapters:Array.isArray(chapters)?JSON.stringify(chapters):null});
    await fs.writeFile(record,JSON.stringify({session_id:session.id}));
    return session.id;
  }finally{await fs.rm(staging,{recursive:true,force:true});}
}
