import type { PlanItem } from "@homebot/shared";

export function isPriorityItem(item: PlanItem): boolean {
  return Boolean(item.important || item.dueDate);
}

export function sortPlanItems(items: PlanItem[]): PlanItem[] {
  return [...items].sort((a, b) => {
    const aPri = isPriorityItem(a);
    const bPri = isPriorityItem(b);
    if (aPri !== bPri) return aPri ? -1 : 1;
    return a.index - b.index;
  });
}

function parseTimeParts(timeStr: string): { hours: number; minutes: number } | null {
  const normalized = timeStr.trim().toUpperCase().replace(/\s+/g, " ");
  const m12 = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m12) {
    let hours = Number(m12[1]);
    const minutes = Number(m12[2]);
    const ampm = m12[3];
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
    return { hours, minutes };
  }
  const m24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) return { hours: Number(m24[1]), minutes: Number(m24[2]) };
  return null;
}

export function itemDueDateTime(item: PlanItem, todayYmd: string): Date | null {
  const dateStr = item.dueDate ?? todayYmd;
  const [y, mo, d] = dateStr.split("-").map(Number);
  if (!y || !mo || !d) return null;

  if (item.time) {
    const parts = parseTimeParts(item.time);
    if (parts) return new Date(y, mo - 1, d, parts.hours, parts.minutes, 0, 0);
  }

  if (item.dueDate) return new Date(y, mo - 1, d, 23, 59, 59, 999);
  return null;
}

export function isItemOverdue(item: PlanItem, todayYmd: string, now = new Date()): boolean {
  if (item.done) return false;
  if (!item.time && !item.dueDate) return false;
  const due = itemDueDateTime(item, todayYmd);
  if (!due) return false;
  return due.getTime() < now.getTime();
}
