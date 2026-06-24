import type { CalendarEvent } from "@homebot/shared";
import { readWorkspaceFile } from "../openclaw/workspace.js";
import { planMemoryPath } from "../plan-file.js";
import { mediaUrlsForImage } from "../media/urls.js";
import { todayDateString } from "../openclaw/state-root.js";

const EVENTS_HEADER = "## Events";
const EVENT_LINE = /^-\s+(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+(.+)$/i;
const TOKEN_REMIND = /\{remind:([^}]+)\}/i;
const TOKEN_IMG = /\{img:([^}]+)\}/i;

export async function parseTodayEvents(date = new Date()): Promise<CalendarEvent[]> {
  const path = planMemoryPath(date);
  const file = await readWorkspaceFile(path);
  if (!file.exists) return [];

  const dateStr = todayDateString(date);
  const lines = file.content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === EVENTS_HEADER);
  if (start === -1) return [];

  const events: CalendarEvent[] = [];
  let idx = 0;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.startsWith("## ")) break;
    if (!line.startsWith("-")) continue;

    const match = line.match(EVENT_LINE);
    if (!match) continue;

    const timeStr = match[1]!.trim();
    let rest = match[2]!.trim();

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

    const startAt = buildIsoDateTime(dateStr, timeStr);
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

  return events;
}

function buildIsoDateTime(dateStr: string, timeStr: string): string {
  const normalized = timeStr.toUpperCase().replace(/\s+/g, "");
  let hours = 0;
  let minutes = 0;

  const m12 = normalized.match(/^(\d{1,2}):(\d{2})(AM|PM)$/);
  const m24 = normalized.match(/^(\d{1,2}):(\d{2})$/);

  if (m12) {
    hours = Number(m12[1]);
    minutes = Number(m12[2]);
    const ampm = m12[3];
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
