import {beforeEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
vi.mock('@/lib/local/session-store',()=>({getLocalSession:vi.fn(()=>({id:'existing'}))}));
vi.mock('@/lib/local/config',()=>({LOCAL_SESSIONS_ROOT:'/tmp/unused'}));
import {POST} from './route';
function request(origin:string,host='127.0.0.1:32195'){
 return new NextRequest('http://localhost:32195/api/cloud-library/restore',{method:'POST',headers:{Origin:origin,Host:host,'Content-Type':'application/json'},body:JSON.stringify({session_id:'existing'})});
}
it('accepts browser origin matching the loopback Host when Next uses an internal URL',async()=>{
 expect((await POST(request('http://127.0.0.1:32195'))).status).toBe(200);
});
it('rejects cross-origin calls and non-loopback hosts',async()=>{
 expect((await POST(request('https://evil.example'))).status).toBe(403);
 expect((await POST(request('http://evil.example','evil.example'))).status).toBe(403);
 expect((await POST(request('http://127.0.0.1:32196'))).status).toBe(403);
});
