import { mkdirSync,existsSync } from 'node:fs';
import { resolve,dirname } from 'node:path';
import { Repo,type Task } from '../db/index.js';
import { git,runner } from './process.js';
export function ensureWorktree(repo:Repo,t:Task){const p=repo.project(t.project_id);const path=resolve(repo.home,'worktrees',p.key,t.identifier);const branch=`aam/${t.identifier}`;
 if(!existsSync(path)){mkdirSync(dirname(path),{recursive:true});const exists=runner('git',['show-ref','--verify','--quiet',`refs/heads/${branch}`],p.repo_path).status===0;git(p.repo_path,['worktree','add',...(exists?[]:['-b',branch]),path,exists?branch:p.base_branch]);
 repo.updateTask(t.id,{branch,worktree_path:path});if(p.setup_cmd){const r=runner('sh',['-c',p.setup_cmd],path);repo.event('setup',r.stdout+r.stderr,t.id);if(r.status!==0)throw new Error(`Setup failed: ${r.stderr}`);}}
 repo.updateTask(t.id,{branch,worktree_path:path});return path;
}
export function prune(repo:Repo,id:string){const t=repo.task(id);if(repo.runs(t.id).some(r=>r.status==='running'))throw new Error('Task has a running worker');const p=repo.project(t.project_id);if(t.worktree_path&&existsSync(t.worktree_path))git(p.repo_path,['worktree','remove',t.worktree_path]);repo.updateTask(id,{worktree_path:null});repo.event('prune','Worktree removed; branch retained',t.id);}
export function merge(repo:Repo,id:string,into:string){const t=repo.task(id),p=repo.project(t.project_id);if(into===p.base_branch||into===`refs/heads/${p.base_branch}`)throw new Error('Refusing to merge into base branch');if(t.status!=='done')throw new Error('Only approved tasks can be merged');if(!t.branch)throw new Error('No task branch');git(p.repo_path,['check-ref-format','--branch',into]);const path=resolve(repo.home,'integration',`${t.identifier}-${process.pid}`);mkdirSync(dirname(path),{recursive:true});git(p.repo_path,['worktree','add',path,into]);try{git(path,['merge','--no-edit',t.branch]);repo.event('merge',`Merged into ${into}`,t.id);}finally{runner('git',['merge','--abort'],path);git(p.repo_path,['worktree','remove',path]);}}
