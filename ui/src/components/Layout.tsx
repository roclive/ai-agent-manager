// Adapted from paperclipai/paperclip (MIT)
import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import { useProjects, useStatus } from "../lib/queries";
import { Sidebar } from "./Sidebar";
import { BreadcrumbBar } from "./BreadcrumbBar";
import { EmptyState } from "./EmptyState";
import { BoardPage } from "../pages-board";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "./ui/sheet";
export function Layout() {
  const [project, setProject] = useState(""),
    [menu, setMenu] = useState(false);
  const projects = useProjects(),
    status = useStatus();
  const sidebar = (
    <Sidebar
      projects={projects.data ?? []}
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
      <div className="workspace">
        <BreadcrumbBar
          project={projects.data?.find((p) => p.key === project)?.name ?? ""}
          onMenu={() => setMenu(true)}
        />
        <main id="main-content">
          <Routes>
            <Route path="/board" element={<BoardPage project={project} />} />
            {["/", "/backlog", "/routines", "/activity", "/settings"].map(
              (path) => (
                <Route key={path} path={path} element={<EmptyState />} />
              ),
            )}
            <Route path="*" element={<p>页面未找到</p>} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
