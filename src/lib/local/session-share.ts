import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {getLocalSessionPaths, selectedRenderMode} from './config';
import {getLocalActiveRun, getLocalSession} from './session-store';
import {connectRenderer, renderConnection} from './render-connection';
const execute=promisify(execFile);
const pending=new Map<string,Promise<string>>();
export class ShareError extends Error {constructor(message:string,public status=502){super(message);}}
export function normalizeShareUrl(value:unknown):string {
  try {
    if(typeof value!=='string')throw Error();
    const url=new URL(value);
    if(!['https://manimate.ai','https://cloud.manimate.ai','https://www.manimate.ai'].includes(url.origin)
      ||url.username||url.password||url.search||url.hash||!/^\/share\/[a-zA-Z0-9_-]+$/.test(url.pathname))throw Error();
    return 'https://manimate.ai'+url.pathname;
  }catch{throw new ShareError('Invalid cloud share response');}
}
export async function shareFingerprint(id:string):Promise<string|null> {
  const session=getLocalSession(id);
  if(!session?.video_path)return null;
  try {
    const video=await fs.stat(session.video_path);
    const project=getLocalSessionPaths(id).projectDir;
    const artifacts=await Promise.all(['script.py','subtitles.srt'].map(async name=>{
      const stat=await fs.stat(path.join(project,name)).catch(()=>null);
      return stat?[stat.size,stat.mtimeMs]:null;
    }));
    return JSON.stringify([session.updated_at,session.video_path,video.size,video.mtimeMs,...artifacts]);
  }catch{return null;}
}
export async function rememberSharedSession(id:string,value:unknown,fingerprint:string|null):Promise<void> {
  if(!fingerprint||getLocalActiveRun(id)||await shareFingerprint(id)!==fingerprint)return;
  const url=normalizeShareUrl(value);
  await fs.writeFile(path.join(getLocalSessionPaths(id).sessionRoot,'share.json'),JSON.stringify({url,fingerprint}));
}
async function cachedShare(id:string):Promise<string|null>{
  try {
    const fingerprint=await shareFingerprint(id);
    if(!fingerprint)return null;
    const record=JSON.parse(await fs.readFile(path.join(getLocalSessionPaths(id).sessionRoot,'share.json'),'utf8'));
    return record.fingerprint===fingerprint?normalizeShareUrl(record.url):null;
  }catch{return null;}
}
async function upload(id:string,visibility?:'public'|'unlisted') {
  const root=getLocalSessionPaths(id).sessionRoot;
  const session=getLocalSession(id);
  const updated=session?.updated_at;
  const fingerprint=await shareFingerprint(id);
  const videoStat=session?.video_path ? await fs.stat(session.video_path) : null;
  const {stdout}=await execute('manim-cloud',['upload-session',root,...(visibility?['--visibility',visibility]:[])],{timeout:240000,maxBuffer:16384});
  if(getLocalActiveRun(id)||getLocalSession(id)?.updated_at!==updated)throw new ShareError('The session changed during upload. Share again after rendering.',409);
  const after=session?.video_path ? await fs.stat(session.video_path) : null;
  if(videoStat?.mtimeMs!==after?.mtimeMs||videoStat?.size!==after?.size)throw new ShareError('The video changed during upload. Share again.',409);
  const result=JSON.parse(stdout);
  const url=normalizeShareUrl(result.share_url);
  await rememberSharedSession(id,url,fingerprint);
  return url;
}
function enqueue(id:string,visibility?:'public'|'unlisted'){
  const previous=pending.get(id);if(previous)return previous;
  const promise=upload(id,visibility).finally(()=>pending.delete(id));pending.set(id,promise);return promise;
}
export async function shareSession(id:string,requested?:unknown) {
  const session=getLocalSession(id);
  if(!session)throw new ShareError('Session not found',404);
  if(getLocalActiveRun(id))throw new ShareError('Wait for the render to finish before sharing.',409);
  if(!session.video_path)throw new ShareError('Finish a render before sharing.',409);
  if(selectedRenderMode()!=='cloud')throw new ShareError('Connect Manim Cloud in settings to save and share videos.',409);
  const settings=await getShareSettings(id);
  const visibility=requested===undefined?settings.visibility:requested;
  if(visibility!=='public'&&visibility!=='unlisted')throw new ShareError('Invalid visibility',400);
  const cached=await cachedShare(id);
  if(cached&&settings.confirmed&&visibility===settings.visibility)return {share_url:cached};
  const connection=await renderConnection();
  if(connection.status!=='ready') {
    const started=await connectRenderer();
    return {connect_url:started.connect_url || connection.connect_url,code:'',status:'pending'};
  }
  const url=cached||await enqueue(id,visibility);
  if(!settings.confirmed||visibility!==settings.visibility){
    await execute('manim-cloud',['share-visibility',id,visibility],{timeout:35000,maxBuffer:16384});
    await fs.writeFile(path.join(getLocalSessionPaths(id).sessionRoot,'share-settings.json'),JSON.stringify({visibility}));
  }
  return {share_url:url};
}
export async function refreshSharedSession(id:string):Promise<void> {
  if(selectedRenderMode()!=='cloud')return;
  const root=getLocalSessionPaths(id).sessionRoot;
  const record=JSON.parse(await fs.readFile(path.join(root,'share.json'),'utf8').catch(()=>'{}'));
  if(record.url)await enqueue(id);
}

export async function getShareSettings(id:string):Promise<{visibility:'public'|'unlisted';share_url:string|null;confirmed:boolean}>{
  if(!getLocalSession(id))throw new ShareError('Session not found',404);
  const settings=JSON.parse(await fs.readFile(path.join(getLocalSessionPaths(id).sessionRoot,'share-settings.json'),'utf8').catch(()=>'{}'));
  return {visibility:settings.visibility==='unlisted'?'unlisted':'public',share_url:await cachedShare(id),confirmed:settings.visibility==='public'||settings.visibility==='unlisted'};
}
