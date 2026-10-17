import { openSync,readFileSync,writeFileSync,closeSync,unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { Repo } from '../db/index.js';
import { alive } from './process.js';
export function withLock<T>(repo:Repo,fn:()=>T):T|undefined{const path=resolve(repo.home,'tick.lock');let fd:number;
 try{fd=openSync(path,'wx');}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;let pid:number;try{pid=Number(readFileSync(path,'utf8'));}catch{return;}
 // A fresh empty file may belong to a contender that has not written its pid yet.
 if(!Number.isInteger(pid)||pid<=0||alive(pid))return;
 try{unlinkSync(path);}catch{return;}return withLock(repo,fn);}
 writeFileSync(fd,String(process.pid));closeSync(fd);try{return fn();}finally{try{if(readFileSync(path,'utf8')===String(process.pid))unlinkSync(path);}catch{ /* already removed */ }}}
