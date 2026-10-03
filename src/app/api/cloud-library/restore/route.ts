import {NextRequest,NextResponse} from 'next/server';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {LOCAL_SESSIONS_ROOT} from '@/lib/local/config';
import {getLocalSession} from '@/lib/local/session-store';
const execute=promisify(execFile);
export const runtime='nodejs';
export async function POST(request:NextRequest){
 try {
  const origin=new URL(request.headers.get('origin') || '');
  if(!['127.0.0.1','localhost','[::1]'].includes(origin.hostname) || origin.protocol!=='http:' || origin.host!==request.headers.get('host'))throw Error('Invalid origin');
 }catch{return NextResponse.json({error:'Invalid origin'},{status:403});}
 try{const {session_id:id}=await request.json();if(typeof id!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(id))return NextResponse.json({error:'Invalid session'},{status:400});
  if(!getLocalSession(id))await execute('manim-cloud',['restore-session',id,LOCAL_SESSIONS_ROOT],{timeout:240000,maxBuffer:16384});
  return NextResponse.json({session_id:id});
 }catch{return NextResponse.json({error:'Could not restore this project. Check your cloud connection and try again.'},{status:502});}
}
