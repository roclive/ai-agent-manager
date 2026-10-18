// Adapted from paperclipai/paperclip (MIT)
import { Menu, ChevronRight } from "lucide-react";
import { useLocation } from "react-router-dom";
import { navigation } from "./Sidebar";
import { Button } from "./ui/button";
export function BreadcrumbBar({
  project,
  onMenu,
}: {
  project: string;
  onMenu: () => void;
}) {
  const location = useLocation();
  return (
    <header className="breadcrumb">
      <Button
        className="mobile-menu"
        size="icon"
        variant="ghost"
        aria-label="打开导航"
        onClick={onMenu}
      >
        <Menu />
      </Button>
      <span>{project || "全部项目"}</span>
      <ChevronRight size={13} />
      <strong>
        {navigation.find((n) => n.path === location.pathname)?.label ??
          "页面未找到"}
      </strong>
      <span className="ml-auto text-xs text-muted-foreground">任务工作台</span>
    </header>
  );
}
