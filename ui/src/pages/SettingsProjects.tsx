import { useState } from "react";
import { useProjects } from "../lib/queries";
import type { Project } from "../lib/types";
import { ExecutorSelect } from "../components/ExecutorSelect";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Load, useAction, ActionError } from "../components/PageSupport";

export function SettingsProjects() {
  const projects = useProjects();
  const action = useAction();
  const [promoting, setPromoting] = useState<Project | null>(null);
  const [editing, setEditing] = useState<Project | null>(null);
  return <>
    <section className="page-section">
      <h2>项目</h2>
      <Load pending={projects.isPending} error={projects.error}>
        {!projects.data?.length && <p>暂无项目</p>}
        <div className="table-scroll"><table><thead><tr><th>项目</th><th>仓库路径</th><th>基础分支</th><th>测试命令</th><th>操作</th></tr></thead>
          <tbody>{projects.data?.map((p) => <tr key={p.id}>
            <td>{p.key} {!!p.auto_review && <span className="badge">自动审查</span>} {!!p.autopilot && <span className="badge">自动驾驶</span>}</td>
            <td>{p.repo_path}</td><td>{p.base_branch}{p.integration_branch && <p>{p.integration_branch} · 领先 {p.ahead_of_base ?? "未知"} 个提交</p>}</td><td>{p.test_cmd || "—"}</td>
            <td>{p.integration_branch && <Button variant="outline" onClick={() => setPromoting(p)}>合并集成分支到 {p.base_branch}</Button>}<Button variant="ghost" onClick={() => setEditing(p)}>编辑</Button></td>
          </tr>)}</tbody>
        </table></div>
      </Load>
    </section>
    <Dialog open={!!promoting} onOpenChange={(v) => { if (!v) setPromoting(null); }}><DialogContent>
      <DialogHeader><DialogTitle>确认合并到 {promoting?.base_branch}</DialogTitle><DialogDescription>以下提交将进入基础分支，请确认。</DialogDescription></DialogHeader>
      <pre>{promoting?.integration_commits || "无新增提交"}</pre><ActionError error={action.error} />
      <Button disabled={action.isPending} onClick={() => action.mutate({ path: `/projects/${encodeURIComponent(promoting!.key)}/promote`, body: { confirm: true } }, { onSuccess: () => setPromoting(null) })}>确认合并</Button>
    </DialogContent></Dialog>
    {editing && <ProjectEditor project={editing} onClose={() => setEditing(null)} />}
  </>;
}

function ProjectEditor({ project, onClose }: { project: Project; onClose: () => void }) {
  const action = useAction();
  return <Dialog open onOpenChange={(v) => { if (!v && !action.isPending) onClose(); }}><DialogContent>
    <DialogHeader><DialogTitle>编辑项目 {project.key}</DialogTitle><DialogDescription>配置仓库与测试命令。</DialogDescription></DialogHeader>
    <form className="task-form" onSubmit={(e) => { e.preventDefault(); action.mutate({ path: `/projects/${encodeURIComponent(project.key)}`, method: "PATCH", body: (() => { const f = new FormData(e.currentTarget); return { ...Object.fromEntries(f), auto_review: f.has("auto_review") ? 1 : 0, autopilot: f.has("autopilot") ? 1 : 0, autopilot_rank: Number(f.get("autopilot_rank")) }; })() }, { onSuccess: onClose }); }}>
      {(["name", "repo_path", "base_branch", "test_cmd", "setup_cmd"] as const).map((k, i) => <label key={k}>{["名称", "仓库路径", "基础分支", "测试命令", "初始化命令"][i]}<Input name={k} required={i < 3} defaultValue={project[k] ?? ""} /></label>)}
      <label><input type="checkbox" name="auto_review" defaultChecked={!!project.auto_review} />自动审查</label>
      <label><input type="checkbox" name="autopilot" defaultChecked={!!project.autopilot} />自动驾驶</label>
      <label>编码执行器（覆盖全局）<ExecutorSelect name="coding_executor" label="项目编码执行器" inheritLabel="继承全局" value={project.coding_executor ?? ""} /></label>
      <label>项目目标<textarea name="goal" defaultValue={project.goal || ""} /></label>
      <label>优先级<Input name="autopilot_rank" type="number" required defaultValue={project.autopilot_rank ?? 100} /></label>
      <label>共享上下文文件<Input name="context_file" defaultValue={project.context_file || ""} /></label>
      <ActionError error={action.error} /><Button disabled={action.isPending}>保存项目</Button>
    </form>
  </DialogContent></Dialog>;
}
