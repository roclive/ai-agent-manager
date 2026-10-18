import { useMutation, useQueryClient } from "@tanstack/react-query";
import { request } from "../lib/api";
import { Skeleton } from "./ui/skeleton";
import type { ReactNode } from "react";
export function useAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      path,
      method = "POST",
      body,
    }: {
      path: string;
      method?: string;
      body?: unknown;
    }) =>
      request(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    onSuccess: () => {
      void client.invalidateQueries();
    },
  });
}
export function Load({
  pending,
  error,
  children,
}: {
  pending: boolean;
  error: Error | null;
  children: ReactNode;
}) {
  if (pending)
    return (
      <div aria-label="正在加载">
        <Skeleton className="h-24 w-full" />
      </div>
    );
  if (error) return <p role="alert">加载失败：{error.message}</p>;
  return <>{children}</>;
}
export function ActionError({ error }: { error: Error | null }) {
  return error ? (
    <div className="toast" role="alert">
      操作失败：{error.message}
    </div>
  ) : null;
}
