import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { useExecutors, useReviewers } from "../lib/queries";
import { NativeSelect } from "./ui/select";
import { ExecutorSelect } from "./ExecutorSelect";
import { WorkerEffortSelect } from "./WorkerEffortSelect";

export function BoardExecutorReviewer({
  onExecutorChange,
  onEffortChange,
  onError,
}: {
  onExecutorChange: (value: string) => void;
  onEffortChange?: (value: string) => void;
  onError?: (message: string) => void;
}) {
  const executors = useExecutors();
  const reviewers = useReviewers();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  if (!executors.data?.executors) return null;

  const currentReviewer = reviewers.data?.reviewer ?? "codex-sol";
  const reviewerList = reviewers.data?.reviewers ?? [];
  const reviewer = reviewerList.find((item) => item.id === currentReviewer);
  const executorLabel = executors.data.executors.find(
    (item) => item.id === executors.data!.coding_executor,
  )?.label ?? executors.data.coding_executor;
  const reviewerLabel = reviewer?.label ?? currentReviewer;
  const cooling = executors.data.executors.filter(
    (item) => item.cooldown_until && Date.parse(item.cooldown_until) > Date.now(),
  );
  const readiness = reviewers.data?.reviewer_ok === true
    ? "已就绪"
    : reviewers.data?.reviewer_ok === false
      ? "未就绪"
      : "尚未检查";

  return (
    <div className="board-executor-reviewer" style={{ position: "relative" }}>
      <button
        type="button"
        aria-label={`编码: ${executorLabel} · 审查: ${reviewerLabel}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        style={{ whiteSpace: "nowrap" }}
      >
        编码: {executorLabel} · 审查: {reviewerLabel}
      </button>
      {open && (
        <div
          role="group"
          aria-label="执行器与审查器设置"
          style={{ position: "absolute", zIndex: 20, right: 0, top: "calc(100% + 6px)", display: "grid", gap: 8, minWidth: 260, padding: 12, border: "1px solid var(--color-border, #ccc)", borderRadius: 8, background: "var(--color-background, white)", boxShadow: "0 8px 24px #0002" }}
        >
          <label style={{ display: "grid", gap: 4 }}>
            编码执行器
            <ExecutorSelect
              label="全局编码执行器"
              value={executors.data.coding_executor}
              onChange={onExecutorChange}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            思考强度
            <WorkerEffortSelect
              executor={executors.data.coding_executor}
              value={executors.data.worker_effort}
              onChange={onEffortChange}
            />
          </label>
          <label style={{ display: "grid", gap: 4 }}>
            审查器
            <NativeSelect
              aria-label="板头审查器"
              value={currentReviewer}
              onChange={(event) => {
                const value = event.target.value;
                void api.setReviewer(value)
                  .then(() => client.invalidateQueries({ queryKey: ["reviewers"] }))
                  .catch((error: Error) => onError?.(`切换审查器失败：${error.message}`));
              }}
            >
              {reviewerList.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.supported}>
                  {item.label}{item.supported ? "" : " — 未就绪"}
                </option>
              ))}
              {!reviewerList.some((item) => item.id === currentReviewer) && (
                <option value={currentReviewer}>{currentReviewer}</option>
              )}
            </NativeSelect>
            <small role="status" title={reviewers.data?.reviewer_error || undefined}>
              {readiness}{reviewers.data?.reviewer_error && reviewers.data.reviewer_ok === false
                ? `：${reviewers.data.reviewer_error}` : ""}
            </small>
          </label>
          {cooling.map((item) => (
            <span key={item.id} role="status" title={`冷却至 ${item.cooldown_until}`}>
              {item.label} 冷却中
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
