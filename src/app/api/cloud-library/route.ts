import {NextResponse} from 'next/server';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const execute=promisify(execFile);
export const runtime='nodejs';
export async function GET(){
 try{const {stdout}=await execute('manim-cloud',['library'],{timeout:35000,maxBuffer:2*1024*1024});return NextResponse.json(JSON.parse(stdout),{headers:{'Cache-Control':'no-store'}});}
 catch{return NextResponse.json({error:'Connect Manim Cloud in settings to see your saved videos.'},{status:401});}
}
