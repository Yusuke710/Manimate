import {NextRequest,NextResponse} from 'next/server';
import {openSharedSession} from '@/lib/local/shared-handoff';
export const runtime='nodejs';
export async function POST(request:NextRequest){
  try{
    const origin=new URL(request.headers.get('origin')||'');
    if(origin.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(origin.hostname)||origin.host!==request.headers.get('host'))return NextResponse.json({error:'Invalid origin'},{status:403});
  }catch{return NextResponse.json({error:'Invalid origin'},{status:403});}
  try{
    const {share}=await request.json();if(typeof share!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(share))return NextResponse.json({error:'Invalid share link.'},{status:400});
    return NextResponse.json({session_id:await openSharedSession(share)});
  }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'Could not open this shared project.'},{status:502});}
}
