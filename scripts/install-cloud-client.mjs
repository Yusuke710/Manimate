import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export async function installCloudClient({root,env,run}) {
  const candidates=['python3.14','python3.13','python3.12','python3.11','python3','/opt/homebrew/opt/python@3.12/bin/python3.12','/usr/local/opt/python@3.12/bin/python3.12'];
  const python=candidates.find(command=>run(command,['-c','import sys; sys.exit(sys.version_info < (3,11))'],{env,encoding:'utf8',timeout:10000}).status===0);
  if(!python) throw Error('Python 3.11 or later is required. Install it, then run manimate --setup.');
  const bin=path.join(root,'tools/bin');
  await fs.mkdir(bin,{recursive:true});
  const quote=s=>"'"+s.replaceAll("'","'\\''")+"'";
  const client=fileURLToPath(new URL('./manim-cloud/manim_cloud.py',import.meta.url));
  await fs.writeFile(path.join(bin,'manim-cloud'),`#!/bin/sh\nexec ${quote(python)} ${quote(client)} "$@"\n`,{mode:0o755});
}
