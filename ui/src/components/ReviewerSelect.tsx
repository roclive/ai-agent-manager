import { useEffect, useState } from "react";
import { useReviewers } from "../lib/queries";
import { NativeSelect } from "./ui/select";

const normalizeReviewer = (value: string) =>
  value === "codex" ? "codex-sol" : value;

export function ReviewerSelect({
  value,
  name = "reviewer",
  onChange,
}: {
  value: string;
  name?: string;
  onChange?: (value: string) => void;
}) {
  const q = useReviewers();
  const normalized = normalizeReviewer(value || "codex-sol");
  const [selected, setSelected] = useState(normalized);
  useEffect(() => setSelected(normalized), [normalized]);
  const health = q.data?.reviewer_ok;
  return (
    <div>
      <NativeSelect
        aria-label="审查器"
        name={name}
        value={selected}
        onChange={(event) => {
          setSelected(event.target.value);
          onChange?.(event.target.value);
        }}
      >
        {(q.data?.reviewers ?? []).map((reviewer) => (
          <option
            key={reviewer.id}
            value={reviewer.id}
            disabled={!reviewer.supported}
          >
            {reviewer.label}
            {reviewer.supported ? "" : " — 未就绪"}
          </option>
        ))}
        {!q.data?.reviewers?.some((reviewer) => reviewer.id === selected) && (
          <option value={selected}>{selected}</option>
        )}
      </NativeSelect>
      {q.data && (
        <p role="status">
          当前审查器：
          {q.data.reviewers?.find((item) => item.id === selected)?.label ??
            selected}
          {selected === q.data.reviewer
            ? health === true
              ? " · 已就绪"
              : health === false
                ? ` · 未就绪${q.data.reviewer_error ? `：${q.data.reviewer_error}` : ""}`
                : " · 尚未检查"
            : " · 保存后检查"}
        </p>
      )}
    </div>
  );
}
