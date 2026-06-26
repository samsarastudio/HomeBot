import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CalendarEvent, CalendarNotification } from "@homebot/shared";
import type { Server as SocketServer } from "socket.io";
import { parseExtraEvents } from "./parser.js";
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
const snoozedUntil = new Map<string, number>();

export function snoozeNotification(id: string, minutes = 5): void {
  snoozedUntil.set(id, Date.now() + minutes * 60_000);
}

function pruneSnoozed(): void {
  const now = Date.now();
  for (const [id, until] of snoozedUntil) {
    if (until <= now) snoozedUntil.delete(id);
  }
}

function isSnoozed(id: string): boolean {
  pruneSnoozed();
  const until = snoozedUntil.get(id);
  return until !== undefined && until > Date.now();
}

export function queueNotifications(notifications: CalendarNotification[]): void {
  for (const n of notifications) {
    if (isSnoozed(n.id)) continue;
    if (!pendingQueue.some((p) => p.id === n.id)) {
      pendingQueue.unshift(n);
    }
  }
  if (pendingQueue.length > 20) pendingQueue.length = 20;
}

export function getPendingNotifications(): CalendarNotification[] {
  pruneSnoozed();
  return pendingQueue.filter((n) => !isSnoozed(n.id));
}

export function dismissNotification(id: string): void {
  const idx = pendingQueue.findIndex((n) => n.id === id);
  if (idx >= 0) pendingQueue.splice(idx, 1);
}

export async function tickEventScheduler(io?: SocketServer): Promise<CalendarNotification[]> {
  const events = await parseExtraEvents();
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
