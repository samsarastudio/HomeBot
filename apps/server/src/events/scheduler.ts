import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CalendarEvent, CalendarNotification } from "@homebot/shared";
import type { Server as SocketServer } from "socket.io";
import { parseTodayEvents } from "./parser.js";
import { getUploadsRoot } from "../uploads.js";
import { todayDateString } from "../openclaw/state-root.js";

interface FiredStore {
  date: string;
  fired: string[];
}

function storePath(): string {
  const dir = join(getUploadsRoot(), ".notifications");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return join(dir, `${todayDateString()}.json`);
}

function loadFired(): FiredStore {
  const path = storePath();
  const today = todayDateString();
  if (!existsSync(path)) return { date: today, fired: [] };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as FiredStore;
    if (data.date !== today) return { date: today, fired: [] };
    return data;
  } catch {
    return { date: today, fired: [] };
  }
}

function saveFired(store: FiredStore): void {
  writeFileSync(storePath(), JSON.stringify(store, null, 2), "utf8");
}

function firedKey(eventId: string, kind: string, remindMin: number): string {
  return `${eventId}:${kind}:${remindMin}`;
}

export function buildNotificationsForEvents(events: CalendarEvent[], now = new Date()): CalendarNotification[] {
  const store = loadFired();
  const notifications: CalendarNotification[] = [];
  const nowMs = now.getTime();

  for (const event of events) {
    const startMs = new Date(event.startAt).getTime();

    for (const remindMin of event.remindMinutes) {
      const triggerMs = startMs - remindMin * 60_000;
      const kind: CalendarNotification["kind"] = remindMin > 0 ? "upcoming" : "start";
      const key = firedKey(event.id, kind, remindMin);

      if (store.fired.includes(key)) continue;

      // Grace window: 5 min for at-time, 2 min for upcoming (scheduler ticks every 60s)
      const graceMs = remindMin === 0 ? 5 * 60_000 : 2 * 60_000;
      if (nowMs < triggerMs || nowMs > triggerMs + graceMs) continue;

      notifications.push({
        id: key,
        eventId: event.id,
        kind,
        title: event.title,
        startAt: event.startAt,
        notes: kind === "upcoming"
          ? `Starts in ${remindMin} minutes${event.notes ? ` — ${event.notes}` : ""}`
          : event.notes,
        imageUrl: event.imageUrl,
        thumbUrl: event.thumbUrl,
      });

      store.fired.push(key);
    }
  }

  if (notifications.length > 0) saveFired(store);
  return notifications;
}

const pendingQueue: CalendarNotification[] = [];

export function queueNotifications(notifications: CalendarNotification[]): void {
  for (const n of notifications) {
    if (!pendingQueue.some((p) => p.id === n.id)) {
      pendingQueue.unshift(n);
    }
  }
  if (pendingQueue.length > 20) pendingQueue.length = 20;
}

export function getPendingNotifications(): CalendarNotification[] {
  return [...pendingQueue];
}

export function dismissNotification(id: string): void {
  const idx = pendingQueue.findIndex((n) => n.id === id);
  if (idx >= 0) pendingQueue.splice(idx, 1);
}

export async function tickEventScheduler(io?: SocketServer): Promise<CalendarNotification[]> {
  const events = await parseTodayEvents();
  const newOnes = buildNotificationsForEvents(events);
  if (newOnes.length > 0) {
    queueNotifications(newOnes);
    for (const n of newOnes) {
      io?.emit("notification:push", n);
    }
  }
  return getPendingNotifications();
}

export function markNotificationDismissed(id: string): void {
  dismissNotification(id);
  const store = loadFired();
  if (!store.fired.includes(id)) {
    store.fired.push(id);
    saveFired(store);
  }
}
