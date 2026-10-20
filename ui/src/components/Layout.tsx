// Adapted from paperclipai/paperclip (MIT)
import { Suspense, lazy, useEffect, useState } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { useProjects, useStatus } from "../lib/queries";
import { Sidebar } from "./Sidebar";
import { BreadcrumbBar } from "./BreadcrumbBar";
const Dashboard = lazy(() =>
  import("../pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Backlog = lazy(() =>
  import("../pages/Backlog").then((m) => ({ default: m.Backlog })),
);
const Routines = lazy(() =>
  import("../pages/Routines").then((m) => ({ default: m.Routines })),
);
const ActivityPage = lazy(() =>
  import("../pages/Activity").then((m) => ({ default: m.ActivityPage })),
);
const Settings = lazy(() =>
  import("../pages/Settings").then((m) => ({ default: m.Settings })),
);
import { NewTaskDialog } from "./NewTaskDialog";
import { useEventStream } from "../lib/queries";
const BoardPage = lazy(() =>
  import("../pages-board").then((m) => ({ default: m.BoardPage })),
);
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
export function Layout() {
  const [project, setProject] = useState(() => {
      try {
        return localStorage.getItem("aam.project") ?? "";
      } catch {
        return "";
      }
    }),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem("aam.project", project);
    } catch {
      /* Storage may be unavailable. */
    }
  }, [project]);
  const projects = useProjects(),
    status = useStatus();
  const visibleProjects = (projects.data ?? []).filter((p) => !p.hidden);
  useEventStream();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    let prefix = "";
    let prefixAt = 0;
    const key = (e: KeyboardEvent) => {
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        (e.target as HTMLElement).closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        )
      )
        return;
      if (e.key === "c") {
        e.preventDefault();
        setCreating(true);
      }
      if (e.key === "/") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>('input[aria-label="搜索任务"]')
          ?.focus();
      }
      if (prefix === "g" && e.key === "b" && Date.now() - prefixAt < 1000)
        navigate("/board");
      prefix = e.key;
      prefixAt = Date.now();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [navigate]);
  const sidebar = (
    <Sidebar
      projects={visibleProjects}
      project={project}
      setProject={setProject}
      status={status.data}
      onNavigate={() => setMenu(false)}
    />
  );
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        跳到主要内容
      </a>
      <div className="desktop-sidebar">{sidebar}</div>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>导航</SheetTitle>
            <SheetDescription>项目和页面导航</SheetDescription>
          </SheetHeader>
          {sidebar}
        </SheetContent>
      </Sheet>
      {creating && (
        <NewTaskDialog
          status="backlog"
          projects={visibleProjects}
          project={project}
          onClose={() => setCreating(false)}
        />
      )}
      <div className="workspace">
        <BreadcrumbBar
          project={projects.data?.find((p) => p.key === project)?.name ?? ""}
          onMenu={() => setMenu(true)}
        />
        <main id="main-content">
          <Suspense fallback={<p role="status">正在加载页面…</p>}>
            <Routes>
              <Route path="/board" element={<BoardPage project={project} />} />
              <Route path="/" element={<Dashboard project={project} />} />
              <Route path="/backlog" element={<Backlog project={project} />} />
              <Route path="/routines" element={<Routines />} />
              <Route
                path="/activity"
                element={<ActivityPage project={project} />}
              />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<p>页面未找到</p>} />
            </Routes>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
