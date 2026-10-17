import { mkdirSync,writeFileSync,readFileSync,existsSync,unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Repo } from './db/index.js';
import { runner } from './core/process.js';
const xml=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function plist(repo:Repo,manager=process.cwd()){const root=fileURLToPath(new URL('..',import.meta.url));const args=[process.execPath,'--import',resolve(root,'node_modules/tsx/dist/loader.mjs'),resolve(root,'src/cli.ts'),'daemon'];return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>com.aam.daemon</string>
<key>ProgramArguments</key><array>${args.map(a=>`<string>${xml(a)}</string>`).join('')}</array>
<key>WorkingDirectory</key><string>${xml(manager)}</string>
<key>EnvironmentVariables</key><dict><key>AAM_HOME</key><string>${xml(repo.home)}</string><key>PATH</key><string>${xml(`/opt/homebrew/bin:${homedir()}/.local/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH||''}`)}</string></dict>
<key>KeepAlive</key><true/><key>RunAtLoad</key><true/>
<key>StandardOutPath</key><string>${xml(resolve(repo.home,'daemon.log'))}</string>
<key>StandardErrorPath</key><string>${xml(resolve(repo.home,'daemon.log'))}</string>
</dict></plist>\n`;}
export function launchd(repo:Repo,action:string,load=false){const path=resolve(homedir(),'Library/LaunchAgents/com.aam.daemon.plist');if(action==='install'){const body=plist(repo);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,body);if(load){const r=runner('launchctl',['load',path],process.cwd());if(r.status!==0)throw new Error(r.stderr);}return body;}if(action==='uninstall'){if(existsSync(path)){const r=runner('launchctl',['unload',path],process.cwd());if(r.status!==0&&process.platform==='darwin'&&runner('launchctl',['list','com.aam.daemon'],process.cwd()).status===0)throw new Error(r.stderr);unlinkSync(path);}return 'Uninstalled';}if(action==='status'){const result=runner('launchctl',['list','com.aam.daemon'],process.cwd());return {installed:existsSync(path),loaded:result.status===0,path,plist:existsSync(path)?readFileSync(path,'utf8'):null};}throw new Error('Unknown launchd action');}
