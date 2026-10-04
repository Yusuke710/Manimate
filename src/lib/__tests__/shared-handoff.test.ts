import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {afterEach,expect,it,vi} from 'vitest';
const roots:string[]=[];
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'shared-handoff-'));roots.push(root);vi.stubEnv('MANIMATE_LOCAL_ROOT',root);vi.stubEnv('MANIMATE_RENDER_MODE','local');vi.resetModules();return {root,...await import('@/lib/local/session-store'),...await import('@/lib/local/shared-handoff')};}
it('opens the existing original session without downloading or overwriting artifacts',async()=>{
 const f=await fixture();const original=f.createLocalSession({model:'claude'});f.updateLocalSession(original.id,{title:'My edits'});
 const fetch=vi.fn().mockResolvedValue(Response.json({source_session_id:original.id,title:'Old title',script_content:'old code'}));vi.stubGlobal('fetch',fetch);
 expect(await f.openSharedSession('share-token')).toBe(original.id);expect(f.getLocalSession(original.id)?.title).toBe('My edits');expect(fetch).toHaveBeenCalledTimes(1);
});
it('new devices create one independent handoff with code, video, subtitles and chapters, then reuse it',async()=>{
 const f=await fixture();const manifest={source_session_id:'original',title:'Scene',script_content:'print("scene")',subtitles_content:'captions',video_url:'https://manimate.ai/media/video',chapters:[{name:'Intro',start:0,duration:2}]};
 const fetch=vi.fn(async(url:string|URL)=>String(url).endsWith('/handoff')?Response.json(manifest):new Response('video bytes'));vi.stubGlobal('fetch',fetch);
 const [id,other]=await Promise.all([f.openSharedSession('share-token'),f.openSharedSession('share-token')]);expect(id).toBe(other);expect(id).not.toBe('original');
 expect(f.getLocalSession(id)?.title).toBe('Handoff: Scene');expect(f.getLocalSession(id)?.chapters).toContain('Intro');
 expect(fs.readFileSync(path.join(f.root,'sessions',id,'project','script.py'),'utf8')).toBe(manifest.script_content);
 expect(fs.readFileSync(path.join(f.root,'sessions',id,'project','subtitles.srt'),'utf8')).toBe('captions');
 expect(await f.openSharedSession('share-token')).toBe(id);expect(fetch.mock.calls.filter(call=>String(call[0]).endsWith('/media/video'))).toHaveLength(1);
});
it('rejects invalid share tokens and arbitrary video fetches',async()=>{
 const f=await fixture();vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({video_url:'http://127.0.0.1/private'})));
 await expect(f.openSharedSession('../secret')).rejects.toThrow('Invalid share');
 await expect(f.openSharedSession('share-token')).rejects.toThrow('Invalid shared video');
});
