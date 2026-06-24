import type { PlanItem, PlanResponse } from "@homebot/shared";
import { readWorkspaceFile, writeWorkspaceFile } from "./openclaw/workspace.js";
import { todayDateString } from "./openclaw/state-root.js";
import { attachmentUrl, mediaUrlsForImage } from "./media/urls.js";

const PLAN_HEADER = "## Plan";
const CHECKBOX_RE = /^- \[([ xX])\]\s*(.*)$/;

const TOKEN_IMG = /\{img:([^}]+)\}/i;
const TOKEN_ATTACH = /\{attach:([^}]+)\}/i;
const TOKEN_ATTACH_ALT = /\battach:([^\s|{}]+)/i;

export function parsePlanSection(content: string): PlanItem[] {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === PLAN_HEADER);
  if (start === -1) return [];

  const items: PlanItem[] = [];
  let index = 0;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!.trimEnd();
    if (line.startsWith("## ") && line.trim() !== PLAN_HEADER) break;

    const match = line.trim().match(CHECKBOX_RE);
    if (!match) continue;

    const done = match[1]!.toLowerCase() === "x";
    const body = match[2]!.trim();
    const tokens = extractMediaTokens(body);
    const parsed = parsePlanLine(tokens.text);

    items.push(enrichPlanItem({
      index,
      ...parsed,
      done,
      raw: line,
      image: tokens.image,
      attachment: tokens.attachment,
    }));
    index++;
  }

  return items;
}

function extractMediaTokens(body: string): { text: string; image?: string; attachment?: string } {
  let text = body;
  let image: string | undefined;
  let attachment: string | undefined;

  const imgMatch = text.match(TOKEN_IMG);
  if (imgMatch) {
    image = imgMatch[1]!.trim();
    text = text.replace(TOKEN_IMG, "").trim();
  }

  const attachBrace = text.match(TOKEN_ATTACH);
  if (attachBrace) {
    attachment = attachBrace[1]!.trim();
    text = text.replace(TOKEN_ATTACH, "").trim();
  } else {
    const attachAlt = text.match(TOKEN_ATTACH_ALT);
    if (attachAlt) {
      attachment = attachAlt[1]!.trim();
      text = text.replace(TOKEN_ATTACH_ALT, "").trim();
    }
  }

  text = text.replace(/\s*\|\s*/g, " ").replace(/\s+/g, " ").trim();
  return { text, image, attachment };
}

function enrichPlanItem(item: PlanItem): PlanItem {
  const enriched = { ...item };
  if (item.image) {
    Object.assign(enriched, mediaUrlsForImage(item.image));
  }
  if (item.attachment) {
    enriched.attachmentUrl = attachmentUrl(item.attachment);
  }
  return enriched;
}

function parsePlanLine(body: string): Pick<PlanItem, "time" | "title" | "description"> {
  const timeMatch = body.match(/^(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+(.+)$/i);
  const rest = timeMatch ? timeMatch[2]! : body;
  const time = timeMatch ? timeMatch[1] : undefined;

  const dashParts = rest.split(/\s+[—–-]\s+/);
  if (dashParts.length >= 2) {
    return { time, title: dashParts[0]!.trim(), description: dashParts.slice(1).join(" — ").trim() };
  }

  return { time, title: rest.trim() };
}

export function planMemoryPath(date = new Date()): string {
  return `memory/${todayDateString(date)}.md`;
}

export async function getPlan(date = new Date()): Promise<PlanResponse> {
  const path = planMemoryPath(date);
  const file = await readWorkspaceFile(path);
  const items = file.exists ? parsePlanSection(file.content) : [];
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return {
    date: todayDateString(date),
    path,
    exists: file.exists,
    items,
    pending,
    done,
    total: items.length,
    doneCount: done.length,
  };
}

export async function getReferencedMediaFilenames(): Promise<Set<string>> {
  const [plan, events] = await Promise.all([getPlan(), import("./events/parser.js").then((m) => m.parseTodayEvents())]);
  const refs = new Set<string>();
  for (const item of plan.items) {
    if (item.image) refs.add(item.image);
  }
  for (const event of events) {
    if (event.image) refs.add(event.image);
  }
  return refs;
}

export async function togglePlanItem(index: number, done: boolean, date = new Date()): Promise<PlanResponse> {
  const path = planMemoryPath(date);
  const file = await readWorkspaceFile(path);

  if (!file.exists) {
    throw new Error("Plan file does not exist");
  }

  const lines = file.content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === PLAN_HEADER);
  if (start === -1) throw new Error("Plan section not found");

  let currentIndex = 0;
  let updated = false;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ") && line.trim() !== PLAN_HEADER) break;
    if (!CHECKBOX_RE.test(line)) continue;

    if (currentIndex === index) {
      const body = line.replace(CHECKBOX_RE, "$2").trim();
      lines[i] = `- [${done ? "x" : " "}] ${body}`;
      updated = true;
      break;
    }
    currentIndex++;
  }

  if (!updated) throw new Error("Plan item not found");

  await writeWorkspaceFile(path, lines.join("\n"));
  return getPlan(date);
}
