#!/usr/bin/env node
// Chrome native host: only a fixed start operation, never commands from a page.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
const root=path.dirname(fileURLToPath(import.meta.url));
function reply(value){const data=Buffer.from(JSON.stringify(value));const header=Buffer.alloc(4);header.writeUInt32LE(data.length);process.stdout.write(Buffer.concat([header,data]));}
let input=Buffer.alloc(0),handled=false;
process.stdin.on('data',async chunk=>{
 if(handled)return;input=Buffer.concat([input,chunk]);
 if(input.length<4)return;
 const length=input.readUInt32LE();if(length>4096){handled=true;reply({status:'error',message:'Invalid request'});process.stdin.pause();return;}
 if(input.length<4+length)return;handled=true;process.stdin.pause();
 try{
  const request=JSON.parse(input.subarray(4,4+length));if(request.action!=='start')throw Error('Unsupported action');
  const config=JSON.parse(await fs.readFile(path.join(process.env.MANIMATE_LOCAL_ROOT || path.join(os.homedir(),'.manimate'),'config.json'),'utf8').catch(()=>'{}'));
  if(!['local','cloud'].includes(config.render_mode)){reply({status:'setup',message:'Run manimate once in your terminal to finish setup.'});return;}
  const child=spawn(process.execPath,[path.join(root,'cli.mjs'),'--no-open','--no-upgrade-check'],{
   env:{...process.env,MANIMATE_NONINTERACTIVE:'1',PATH:[path.dirname(process.execPath),path.join(os.homedir(),'.local/bin'),path.join(os.homedir(),'.manimate/tools/bin'),path.join(os.homedir(),'.manimate/tools/npm-global/bin'),'/opt/homebrew/bin','/usr/local/bin','/Library/TeX/texbin',process.env.PATH].filter(Boolean).join(':')},stdio:['ignore','pipe','pipe']});
  let error='',done=false;child.stdout.resume();child.stderr.on('data',b=>error=(error+b).slice(-2000));
  const timer=setTimeout(()=>{child.kill();finish({status:'error',message:'Startup timed out. Run manimate in your terminal to see details.'});},90000);
  function finish(value){if(done)return;done=true;clearTimeout(timer);reply(value);}
  child.on('error',()=>finish({status:'error',message:'Could not launch Manimate. Run the installer again.'}));
  child.on('exit',code=>finish(code===0?{status:'ready'}:{status:'setup',message:error || 'Run manimate in your terminal to finish setup.'}));
 }catch{reply({status:'error',message:'Could not start Manimate.'});}
});
