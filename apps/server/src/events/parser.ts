import type { CalendarEvent } from "@homebot/shared";
import { readWorkspaceFile } from "../openclaw/workspace.js";
import { planMemoryPath } from "../plan-file.js";
import { mediaUrlsForImage } from "../media/urls.js";
import { todayDateString } from "../openclaw/state-root.js";

const EVENTS_HEADERS = ["## Events", "## Check-ins", "## Check-Ins", "## CHECK-INS"];
const TOKEN_REMIND = /\{remind:([^}]+)\}/i;
const TOKEN_IMG = /\{img:([^}]+)\}/i;

export async function parseTodayEvents(date = new Date()): Promise<CalendarEvent[]> {
  const path = planMemoryPath(date);
  const file = await readWorkspaceFile(path);
  if (!file.exists) return [];

  const dateStr = todayDateString(date);
  const lines = file.content.split(/\r?\n/);
  const start = lines.findIndex((l) => EVENTS_HEADERS.includes(l.trim()));
  if (start === -1) return [];

  const events: CalendarEvent[] = [];
  let idx = 0;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("## ")) break;
    if (!line.startsWith("-")) continue;

    const parsed = parseEventLine(line);
    if (!parsed) continue;

    let rest = parsed.rest;

    let remindMinutes = [10, 0];
    const remindMatch = rest.match(TOKEN_REMIND);
    if (remindMatch) {
      remindMinutes = remindMatch[1]!
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => !Number.isNaN(n));
      rest = rest.replace(TOKEN_REMIND, "").trim();
    }

    let image: string | undefined;
    const imgMatch = rest.match(TOKEN_IMG);
    if (imgMatch) {
      image = imgMatch[1]!.trim();
      rest = rest.replace(TOKEN_IMG, "").trim();
    }

    const dashParts = rest.split(/\s+[—–-]\s+/);
    const title = dashParts[0]!.trim();
    const notes = dashParts.length > 1 ? dashParts.slice(1).join(" — ").trim() : undefined;

    const startAt = buildIsoDateTime(dateStr, parsed.timeStr);
    const event: CalendarEvent = {
      id: `evt-${dateStr}-${idx}`,
      title,
      startAt,
      notes,
      image,
      remindMinutes,
    };

    if (image) {
      Object.assign(event, mediaUrlsForImage(image));
    }

    events.push(event);
    idx++;
  }

  return events.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

/** Parse `- 6pm CHECK IN`, `- 11.30 pm CHECK IN`, `- 09:00 Morning check-in` */
export function parseEventLine(line: string): { timeStr: string; rest: string } | null {
  const body = line.replace(/^-\s+/, "").trim();
  if (!body) return null;

  // HH:MM or HH.MM with optional AM/PM, then title
  let m = body.match(/^(\d{1,2}[.:]\d{2})\s*(AM|PM)?\s+(.+)$/i);
  if (m) {
    const timeStr = m[2] ? `${m[1]!.replace(".", ":")} ${m[2]}` : m[1]!.replace(".", ":");
    return { timeStr, rest: m[3]!.trim() };
  }

  // H AM/PM or Hpm / 6 pm
  m = body.match(/^(\d{1,2})\s*(AM|PM)\s+(.+)$/i);
  if (m) return { timeStr: `${m[1]} ${m[2]}`, rest: m[3]!.trim() };

  m = body.match(/^(\d{1,2})(AM|PM)\s+(.+)$/i);
  if (m) return { timeStr: `${m[1]} ${m[2]}`, rest: m[3]!.trim() };

  return null;
}

export function buildIsoDateTime(dateStr: string, timeStr: string): string {
  let normalized = timeStr.toUpperCase().replace(/\s+/g, " ").trim();
  normalized = normalized.replace(/\./g, ":");

  let hours = 0;
  let minutes = 0;

  const mNoMin = normalized.match(/^(\d{1,2})\s*(AM|PM)$/);
  const m12 = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  const m12NoSpace = normalized.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
  const m24 = normalized.match(/^(\d{1,2}):(\d{2})$/);

  if (mNoMin) {
    hours = Number(mNoMin[1]);
    minutes = 0;
    const ampm = mNoMin[2];
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  } else if (m12 || m12NoSpace) {
    const parts = (m12 ?? m12NoSpace)!;
    hours = Number(parts[1]);
    minutes = Number(parts[2]);
    const ampm = parts[3];
    if (ampm === "PM" && hours < 12) hours += 12;
    if (ampm === "AM" && hours === 12) hours = 0;
  } else if (m24) {
    hours = Number(m24[1]);
    minutes = Number(m24[2]);
  }

  const [y, mo, d] = dateStr.split("-").map(Number);
  const dt = new Date(y!, mo! - 1, d!, hours, minutes, 0, 0);
  return dt.toISOString();
}
