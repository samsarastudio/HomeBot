import type { DashboardData } from "@homebot/shared";
import { io } from "socket.io-client";

export type DashboardListener = (data: DashboardData) => void;

export function startLiveDashboard(
  onUpdate: DashboardListener,
  refreshMs = 5000,
): () => void {
  let stopped = false;

  const fetchData = async () => {
    if (stopped) return;
    try {
      const res = await fetch("/api/dashboard/data");
      if (res.ok) onUpdate((await res.json()) as DashboardData);
    } catch {
      /* retry on next interval */
    }
  };

  void fetchData();
  const interval = setInterval(() => void fetchData(), refreshMs);

  const socket = io({ path: "/socket.io" });
  socket.on("dashboard:update", (data: DashboardData) => {
    if (!stopped) onUpdate(data);
  });

  return () => {
    stopped = true;
    clearInterval(interval);
    socket.disconnect();
  };
}
