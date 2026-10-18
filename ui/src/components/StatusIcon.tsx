// Adapted from paperclipai/paperclip (MIT)
import {
  Circle,
  CircleDashed,
  CircleDot,
  CheckCircle2,
  Clock,
  OctagonAlert,
  XCircle,
} from "lucide-react";
import { statusLabels, type TaskStatus } from "../lib/types";
const icons = {
  backlog: CircleDashed,
  ready: Circle,
  in_progress: CircleDot,
  in_review: Clock,
  blocked: OctagonAlert,
  done: CheckCircle2,
  cancelled: XCircle,
};
export function StatusIcon({ status }: { status: TaskStatus }) {
  const Icon = icons[status];
  return (
    <span aria-label={statusLabels[status]} className={`status-${status}`}>
      <Icon size={16} />
    </span>
  );
}
