import type { CalendarNotification, DashboardData } from "@homebot/shared";
import { io, type Socket } from "socket.io-client";

export type DashboardListener = (data: DashboardData) => void;
export type NotificationListener = (notification: CalendarNotification) => void;

export function startLiveDashboard(
  onUpdate: DashboardListener,
  onNotification: NotificationListener,
  refreshMs = 5000,
): () => void {
  let stopped = false;
  let socket: Socket | null = null;

  const fetchData = async () => {
    if (stopped) return;
    try {
      const res = await fetch("/api/dashboard/data");
      if (res.ok) onUpdate((await res.json()) as DashboardData);
    } catch {
      /* retry */
    }
  };

  void fetchData();
  const interval = setInterval(() => void fetchData(), refreshMs);

  socket = io({ path: "/socket.io" });
  socket.on("dashboard:update", (data: DashboardData) => {
    if (!stopped) onUpdate(data);
  });
  socket.on("notification:push", (notification: CalendarNotification) => {
    if (!stopped) onNotification(notification);
  });

  return () => {
    stopped = true;
    clearInterval(interval);
    socket?.disconnect();
  };
}
