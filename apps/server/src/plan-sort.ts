import type { PlanItem } from "@homebot/shared";

export function isTimeBound(item: PlanItem): boolean {
  return Boolean(item.time || item.dueDate);
}

/** Time-bound items first (by schedule), then newest-added items. */
export function sortPlanItems(items: PlanItem[], todayYmd: string): PlanItem[] {
  return [...items].sort((a, b) => {
    const aBound = isTimeBound(a);
    const bBound = isTimeBound(b);
    if (aBound !== bBound) return aBound ? -1 : 1;

    if (aBound && bBound) {
      const da = itemDueDateTime(a, todayYmd)?.getTime() ?? 0;
      const db = itemDueDateTime(b, todayYmd)?.getTime() ?? 0;
      if (da !== db) return da - db;
      return b.index - a.index;
    }

    return b.index - a.index;
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

export function enrichPlanItemMeta(item: PlanItem, todayYmd: string): PlanItem {
  const enriched: PlanItem = {
    ...item,
    overdue: isItemOverdue(item, todayYmd),
  };

  if (!item.done && item.carryFrom) {
    const days = daysBetweenYmd(item.carryFrom, todayYmd);
    enriched.carriedDays = days;
    if (days >= 2) enriched.carryBand = "red";
    else if (days >= 1) enriched.carryBand = "orange";
  }

  return enriched;
}

function daysBetweenYmd(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = fromYmd.split("-").map(Number);
  const [ty, tm, td] = toYmd.split("-").map(Number);
  const from = Date.UTC(fy!, fm! - 1, fd!);
  const to = Date.UTC(ty!, tm! - 1, td!);
  return Math.round((to - from) / 86_400_000);
}
