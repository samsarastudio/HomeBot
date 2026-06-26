import type { PlanItem } from "@homebot/shared";
import { itemDueDateTime } from "./plan-utils";

export interface NowNextInfo {
  item: PlanItem;
  due: Date;
  label: string;
}

export function findNextTimedItem(items: PlanItem[], todayYmd: string, now = new Date()): NowNextInfo | null {
  const nowMs = now.getTime();
  let best: NowNextInfo | null = null;

  for (const item of items) {
    if (item.done || (!item.time && !item.dueDate)) continue;
    const due = itemDueDateTime(item, todayYmd);
    if (!due) continue;
    const dueMs = due.getTime();
    if (dueMs < nowMs - 60_000) continue;
    if (!best || dueMs < best.due.getTime()) {
      const cat = item.category === "work" ? "Work" : "Personal";
      best = { item, due, label: cat };
    }
  }

  return best;
}

export function formatCountdown(due: Date, now = new Date()): string {
  const diffMs = due.getTime() - now.getTime();
  if (diffMs <= 0) return "now";
  const mins = Math.ceil(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hours}h ${rem}m` : `${hours}h`;
}

export function formatNowNextText(info: NowNextInfo, now = new Date()): string {
  const time = info.item.time ?? info.due.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const countdown = formatCountdown(info.due, now);
  return `NEXT: ${time} ${info.label} — ${info.item.title} (${countdown})`;
}
