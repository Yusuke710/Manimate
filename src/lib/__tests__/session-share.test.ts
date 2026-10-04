import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({run:vi.fn(),connection:vi.fn(),connect:vi.fn()}));
vi.mock('node:child_process',async original=>({...await original<typeof import('node:child_process')>(),execFile:mocks.run}));
vi.mock('@/lib/local/render-connection',()=>({renderConnection:mocks.connection,connectRenderer:mocks.connect}));
const roots:string[]=[];
beforeEach(()=>{mocks.run.mockImplementation((_f,_a,_o,cb)=>cb(null,{stdout:JSON.stringify({share_url:'https://manimate.ai/share/test'})}));mocks.connection.mockResolvedValue({status:'ready'});mocks.connect.mockResolvedValue({status:'pending',connect_url:'https://cloud.manimate.ai/authorize'});});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();for(const root of roots.splice(0))fs.rmSync(root,{recursive:true,force:true});});
async function fixture(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'share-'));roots.push(root);vi.stubEnv('MANIMATE_LOCAL_ROOT',root);vi.stubEnv('MANIMATE_RENDER_MODE','cloud');vi.resetModules();const store=await import('@/lib/local/session-store');const session=store.createLocalSession({model:'claude'});const dir=path.join(root,'sessions',session.id,'project');fs.mkdirSync(dir,{recursive:true});const video=path.join(dir,'video.mp4');fs.writeFileSync(video,'video');store.updateLocalSession(session.id,{video_path:video});return{...store,...await import('@/lib/local/session-share'),id:session.id,video};}
it('shares through the existing cloud connection',async()=>{const f=await fixture();expect(await f.shareSession(f.id)).toEqual({share_url:'https://manimate.ai/share/test'});expect(mocks.run.mock.calls[0][0]).toBe('manim-cloud');expect(mocks.run.mock.calls[0][1][0]).toBe('upload-session');});
it('does not share a running session',async()=>{const f=await fixture();const msg=f.insertLocalMessage({session_id:f.id,role:'user',content:'render'});f.createLocalRun({session_id:f.id,user_message_id:msg});await expect(f.shareSession(f.id)).rejects.toMatchObject({status:409});expect(mocks.run).not.toHaveBeenCalled();});
it('rejects a stale link when the video changes during upload',async()=>{const f=await fixture();mocks.run.mockImplementationOnce((_f,_a,_o,cb)=>{fs.writeFileSync(f.video,'changed video');cb(null,{stdout:JSON.stringify({share_url:'https://manimate.ai/share/test'})});});await expect(f.shareSession(f.id)).rejects.toMatchObject({status:409});});
it('starts the same Google flow when disconnected',async()=>{const f=await fixture();mocks.connection.mockResolvedValue({status:'disconnected'});expect(await f.shareSession(f.id)).toMatchObject({connect_url:'https://cloud.manimate.ai/authorize',status:'pending'});expect(mocks.run).not.toHaveBeenCalled();});

it('canonicalizes trusted legacy links and rejects unrelated or malformed responses',async()=>{
 const f=await fixture();
 for(const origin of ['https://manimate.ai','https://cloud.manimate.ai','https://www.manimate.ai'])expect(f.normalizeShareUrl(origin+'/share/token')).toBe('https://manimate.ai/share/token');
 for(const value of [null,'invalid','http://manimate.ai/share/token','https://evil.example/share/token','https://manimate.ai.evil.example/share/token','https://user:pass@manimate.ai/share/token','https://manimate.ai/library','https://manimate.ai/share/token?redirect=evil'])expect(()=>f.normalizeShareUrl(value)).toThrow('Invalid cloud share response');
});
it('saves canonical links when the upload client returns a legacy domain',async()=>{
 const f=await fixture();mocks.run.mockImplementationOnce((_f,_a,_o,cb)=>cb(null,{stdout:JSON.stringify({share_url:'https://cloud.manimate.ai/share/legacy'})}));
 expect(await f.shareSession(f.id)).toEqual({share_url:'https://manimate.ai/share/legacy'});
 expect(JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(f.video)),'share.json'),'utf8')).url).toBe('https://manimate.ai/share/legacy');
});
