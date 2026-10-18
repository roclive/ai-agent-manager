import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "../components/ui/button";
export function ThemeToggle() {
  const [dark, setDark] = useState(() => {
    try {
      const stored = localStorage.getItem("aam-theme");
      if (stored === "dark" || stored === "light") return stored === "dark";
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);
  useEffect(() => {
    const m = window.matchMedia?.("(prefers-color-scheme: dark)");
    const sync = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem("aam-theme")) return;
      } catch {}
      setDark(e.matches);
    };
    const localSync = (event: Event) =>
      setDark((event as CustomEvent<boolean>).detail);
    m?.addEventListener("change", sync);
    window.addEventListener("aam-theme-change", localSync);
    return () => {
      m?.removeEventListener("change", sync);
      window.removeEventListener("aam-theme-change", localSync);
    };
  }, []);
  return (
    <Button
      variant="ghost"
      onClick={() => {
        const next = !dark;
        setDark(next);
        window.dispatchEvent(
          new CustomEvent("aam-theme-change", { detail: next }),
        );
        try {
          localStorage.setItem("aam-theme", next ? "dark" : "light");
        } catch {}
      }}
      aria-label="切换主题"
    >
      {dark ? <Sun /> : <Moon />}
      {dark ? "浅色模式" : "深色模式"}
    </Button>
  );
}
