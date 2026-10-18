import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
export function useEventStream() {
  const client = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const stream = new EventSource("/api/stream");
    stream.onerror = () => setLive(false);
    const invalidate = () => {
      void client.invalidateQueries({ queryKey: ["tasks"] });
      void client.invalidateQueries({ queryKey: ["runs"] });
      void client.invalidateQueries({ queryKey: ["projects"] });
      void client.invalidateQueries({ queryKey: ["status"] });
      for (const key of ["events", "routines", "settings"])
        void client.invalidateQueries({ queryKey: [key] });
    };
    stream.onopen = () => {
      setLive(true);
      invalidate();
    };
    stream.addEventListener("events", invalidate);
    return () => stream.close();
  }, [client]);
  return live;
}
export const useTasks = (live = false) =>
  useQuery({
    queryKey: ["tasks"],
    queryFn: api.tasks,
    refetchInterval: live ? false : 5000,
  });
export const useRuns = (live = false) =>
  useQuery({
    queryKey: ["runs"],
    queryFn: api.runs,
    refetchInterval: live ? false : 5000,
  });
export const useProjects = () =>
  useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
    refetchInterval: 10000,
  });
export const useStatus = () =>
  useQuery({
    queryKey: ["status"],
    queryFn: api.status,
    refetchInterval: 10000,
    retry: false,
  });
