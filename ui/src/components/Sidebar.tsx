// Adapted from paperclipai/paperclip (MIT)
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  Columns3,
  ListTodo,
  CalendarClock,
  Activity,
  Settings,
  Layers,
  ChevronsUpDown,
  Check,
} from "lucide-react";
import type { Project, Status } from "../lib/types";
import { ThemeToggle } from "../lib/theme";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
export const navigation = [
  { path: "/", label: "总览", icon: LayoutDashboard },
  { path: "/board", label: "看板", icon: Columns3 },
  { path: "/backlog", label: "待办", icon: ListTodo },
  { path: "/routines", label: "定时任务", icon: CalendarClock },
  { path: "/activity", label: "活动", icon: Activity },
  { path: "/settings", label: "设置", icon: Settings },
];
export function Sidebar({
  projects,
  project,
  setProject,
  status,
  onNavigate,
}: {
  projects: Project[];
  project: string;
  setProject: (v: string) => void;
  status?: Status;
  onNavigate?: () => void;
}) {
  const selected = projects.find((p) => p.key === project);
  return (
    <aside className="sidebar">
      <div className="brand">
        <Layers size={22} />
        <strong>aam</strong>
        <span>工作空间</span>
      </div>
      <div className="project-switcher">
        <span className="project-label">项目</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between"
              aria-label="切换项目"
            >
              <span
                className="project-dot"
                style={{ background: selected?.color ?? "#8b8b95" }}
              />
              <span className="truncate">{selected?.name ?? "全部项目"}</span>
              <ChevronsUpDown size={13} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuItem onSelect={() => setProject("")}>
              <Layers size={14} />
              全部项目{!project && <Check className="ml-auto" size={13} />}
            </DropdownMenuItem>
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onSelect={() => setProject(p.key)}>
                <span
                  className="project-dot"
                  style={{ background: p.color ?? "#8b8b95" }}
                />
                <span>{p.name}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {p.running ?? 0} 运行中
                </span>
                {project === p.key && <Check size={13} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <nav aria-label="主导航">
        {navigation.map(({ path, label, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end
            onClick={onNavigate}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <footer>
        <div className="daemon-status">
          <i className={status?.daemon.running ? "online" : ""} />
          {status
            ? status.daemon.running
              ? "守护进程运行中"
              : "守护进程未运行"
            : "守护进程状态不可用"}
        </div>
        {status?.cooldown_until &&
          Date.parse(status.cooldown_until) > Date.now() && (
            <p>
              冷却至{" "}
              {new Date(status.cooldown_until).toLocaleTimeString("zh-CN")}
            </p>
          )}
        <ThemeToggle />
        <span className="local-label">本地工作空间 · aam</span>
      </footer>
    </aside>
  );
}
