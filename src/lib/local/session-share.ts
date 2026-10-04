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
async function upload(id:string) {
  const root=getLocalSessionPaths(id).sessionRoot;
  const session=getLocalSession(id);
  const updated=session?.updated_at;
  const videoStat=session?.video_path ? await fs.stat(session.video_path) : null;
  const {stdout}=await execute('manim-cloud',['upload-session',root],{timeout:240000,maxBuffer:16384});
  if(getLocalActiveRun(id)||getLocalSession(id)?.updated_at!==updated)throw new ShareError('The session changed during upload. Share again after rendering.',409);
  const after=session?.video_path ? await fs.stat(session.video_path) : null;
  if(videoStat?.mtimeMs!==after?.mtimeMs||videoStat?.size!==after?.size)throw new ShareError('The video changed during upload. Share again.',409);
  const result=JSON.parse(stdout);
  const url=normalizeShareUrl(result.share_url);
  await fs.writeFile(path.join(root,'share.json'),JSON.stringify({url}));
  return url;
}
function enqueue(id:string){
  const previous=pending.get(id);if(previous)return previous;
  const promise=upload(id).finally(()=>pending.delete(id));pending.set(id,promise);return promise;
}
export async function shareSession(id:string) {
  const session=getLocalSession(id);
  if(!session)throw new ShareError('Session not found',404);
  if(getLocalActiveRun(id))throw new ShareError('Wait for the render to finish before sharing.',409);
  if(!session.video_path)throw new ShareError('Finish a render before sharing.',409);
  if(selectedRenderMode()!=='cloud')throw new ShareError('Connect Manim Cloud in settings to save and share videos.',409);
  const connection=await renderConnection();
  if(connection.status!=='ready') {
    const started=await connectRenderer();
    return {connect_url:started.connect_url || connection.connect_url,code:'',status:'pending'};
  }
  return {share_url:await enqueue(id)};
}
export async function refreshSharedSession(id:string):Promise<void> {
  if(selectedRenderMode()!=='cloud')return;
  const root=getLocalSessionPaths(id).sessionRoot;
  const record=JSON.parse(await fs.readFile(path.join(root,'share.json'),'utf8').catch(()=>'{}'));
  if(record.url)await enqueue(id);
}
