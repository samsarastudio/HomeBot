import type { CheckinSlot, PlanItem, PlanResponse } from "@homebot/shared";
import { todayDateString } from "../openclaw/state-root.js";
import type { CalendarEvent } from "@homebot/shared";

export const CHECKIN_SCHEDULE = {
  morning: { hour: 9, minute: 0, label: "Morning check-in", timeLabel: "9:00 AM" },
  evening: { hour: 18, minute: 0, label: "Evening check-in", timeLabel: "6:00 PM" },
  work: { hour: 23, minute: 30, label: "Work check-in", timeLabel: "11:30 PM" },
} as const;

export type CheckinKind = keyof typeof CHECKIN_SCHEDULE;

export function slotsForCheckinCategory(category: PlanItem["checkin"]): CheckinKind[] {
  switch (category) {
    case "work":
      return ["work"];
    case "morning":
      return ["morning"];
    case "evening":
      return ["evening"];
    case "personal":
    default:
      return ["morning", "evening"];
  }
}

function slotStartIso(dateStr: string, kind: CheckinKind): string {
  const { hour, minute } = CHECKIN_SCHEDULE[kind];
  const [y, mo, d] = dateStr.split("-").map(Number);
  return new Date(y!, mo! - 1, d!, hour, minute, 0, 0).toISOString();
}

export function buildCheckinSlots(plan: PlanResponse, date = new Date()): CheckinSlot[] {
  const dateStr = plan.date || todayDateString(date);
  const kinds: CheckinKind[] = ["morning", "evening", "work"];

  return kinds.map((kind) => {
    const schedule = CHECKIN_SCHEDULE[kind];
    const pending: PlanItem[] = [];
    const done: PlanItem[] = [];

    for (const item of plan.items) {
      const slots = slotsForCheckinCategory(item.checkin ?? "personal");
      if (!slots.includes(kind)) continue;
      if (item.done) done.push(item);
      else pending.push(item);
    }

    return {
      id: `checkin-${dateStr}-${kind}`,
      kind,
      label: schedule.label,
      time: schedule.timeLabel,
      startAt: slotStartIso(dateStr, kind),
      pending,
      done,
      pendingCount: pending.length,
      doneCount: done.length,
    };
  });
}

export function checkinSlotToEvent(slot: CheckinSlot): CalendarEvent {
  const summary =
    slot.pendingCount === 0
      ? "All done — nothing pending"
      : slot.pending.map((i) => i.title).slice(0, 8).join(", ") +
        (slot.pendingCount > 8 ? ` +${slot.pendingCount - 8} more` : "");

  return {
    id: slot.id,
    title: slot.label,
    startAt: slot.startAt,
    notes: summary,
    remindMinutes: [10, 0],
  };
}

export function buildDailyCheckinEvents(plan: PlanResponse, date = new Date()): CalendarEvent[] {
  return buildCheckinSlots(plan, date).map(checkinSlotToEvent);
}

export function marqueeText(slots: CheckinSlot[]): string {
  return slots
    .map((s) => {
      const count = s.pendingCount;
      const tag = s.kind === "work" ? "work" : "personal";
      return `${s.time} · ${count} ${tag}`;
    })
    .join("   ◆   ");
}
