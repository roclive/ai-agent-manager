// Adapted from paperclipai/paperclip (MIT)
import { ArrowUp, ArrowDown, Minus, AlertTriangle } from "lucide-react";
import type { Priority } from "../lib/types";
const config = {
  P0: { icon: AlertTriangle, color: "text-red-500" },
  P1: { icon: ArrowUp, color: "text-orange-500" },
  P2: { icon: Minus, color: "text-muted-foreground" },
  P3: { icon: ArrowDown, color: "text-muted-foreground" },
};
export function PriorityIcon({ priority }: { priority: Priority }) {
  const { icon: Icon, color } = config[priority];
  return (
    <span aria-label={`优先级 ${priority}`} title={priority} className={color}>
      <Icon size={14} />
    </span>
  );
}
