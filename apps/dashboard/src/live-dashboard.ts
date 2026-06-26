import type { CalendarNotification, DashboardData } from "@homebot/shared";
import { io, type Socket } from "socket.io-client";

export type DashboardListener = (data: DashboardData) => void;
export type NotificationListener = (notification: CalendarNotification) => void;
export type ConnectionListener = (online: boolean) => void;

export function startLiveDashboard(
  onUpdate: DashboardListener,
  onNotification: NotificationListener,
  refreshMs = 5000,
  onConnection?: ConnectionListener,
): () => void {
  let stopped = false;
  let socket: Socket | null = null;
  let online = true;
  let failCount = 0;

  const setOnline = (next: boolean) => {
    if (online === next) return;
    online = next;
    onConnection?.(online);
  };

  const fetchData = async () => {
    if (stopped) return;
    try {
      const res = await fetch("/api/dashboard/data");
      if (res.ok) {
        failCount = 0;
        setOnline(true);
        onUpdate((await res.json()) as DashboardData);
      } else {
        failCount++;
        if (failCount >= 2) setOnline(false);
      }
    } catch {
      failCount++;
      if (failCount >= 2) setOnline(false);
    }
  };

  void fetchData();
  const interval = setInterval(() => void fetchData(), refreshMs);

  socket = io({ path: "/socket.io" });
  socket.on("connect", () => setOnline(true));
  socket.on("disconnect", () => setOnline(false));
  socket.on("dashboard:update", (data: DashboardData) => {
    if (!stopped) {
      setOnline(true);
      onUpdate(data);
    }
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
