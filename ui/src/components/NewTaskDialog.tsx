import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  statusLabels,
  roleLabels,
  type TaskStatus,
  type NewTask,
  type Project,
  type Role,
  type Worker,
  type Priority,
} from "../lib/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/select";
import { Button } from "./ui/button";
export function NewTaskDialog({
  status,
  projects,
  project,
  onClose,
}: {
  status: TaskStatus;
  projects: Project[];
  project: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [task, setTask] = useState<NewTask>({
    title: "",
    description: "",
    priority: "P1",
    role: "any",
    worker: "codex",
    project: project || projects[0]?.key || "",
    status,
  });
  const mutation = useMutation({
    mutationFn: api.createTask,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["tasks"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>新建任务</DialogTitle>
          <DialogDescription>
            创建到「{statusLabels[status]}」
          </DialogDescription>
        </DialogHeader>
        <form
          className="task-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(task);
          }}
        >
          <label>
            标题
            <Input
              required
              autoFocus
              maxLength={500}
              value={task.title}
              onChange={(e) => setTask({ ...task, title: e.target.value })}
            />
          </label>
          <label>
            描述
            <Textarea
              value={task.description}
              onChange={(e) =>
                setTask({ ...task, description: e.target.value })
              }
            />
          </label>
          <label>
            项目
            <NativeSelect
              required
              value={task.project}
              onChange={(e) => setTask({ ...task, project: e.target.value })}
            >
              {projects.length === 0 && <option value="">暂无项目</option>}
              {projects.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          </label>
          <div className="form-row">
            <label>
              优先级
              <NativeSelect
                value={task.priority}
                onChange={(e) =>
                  setTask({ ...task, priority: e.target.value as Priority })
                }
              >
                {["P0", "P1", "P2", "P3"].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </NativeSelect>
            </label>
            <label>
              角色
              <NativeSelect
                value={task.role}
                onChange={(e) =>
                  setTask({ ...task, role: e.target.value as Role })
                }
              >
                {Object.entries(roleLabels).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </label>
            <label>
              执行器
              <NativeSelect
                value={task.worker}
                onChange={(e) =>
                  setTask({ ...task, worker: e.target.value as Worker })
                }
              >
                <option>codex</option>
                <option>opencode</option>
              </NativeSelect>
            </label>
          </div>
          {mutation.error && <p role="alert">{mutation.error.message}</p>}
          <Button
            type="submit"
            disabled={mutation.isPending || !task.title.trim() || !task.project}
          >
            {mutation.isPending ? "创建中…" : "创建任务"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
