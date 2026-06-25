import type { PlanCategory, PlanItem, PlanResponse } from "@homebot/shared";
import { readWorkspaceFile, writeWorkspaceFile } from "./openclaw/workspace.js";
import { todayDateString } from "./openclaw/state-root.js";
import { attachmentUrl, mediaUrlsForImage } from "./media/urls.js";
import { parseExtraEvents } from "./events/parser.js";
import { enrichPlanItemMeta, sortPlanItems } from "./plan-sort.js";

const PLAN_HEADER = "## Plan";
const CHECKBOX_RE = /^- \[([ xX])\]\s*(.*)$/;

const TOKEN_IMG = /\{img:([^}]+)\}/i;
const TOKEN_ATTACH = /\{attach:([^}]+)\}/i;
const TOKEN_ATTACH_ALT = /\battach:([^\s|{}]+)/i;
const TOKEN_WORK = /\{work\}/i;
const TOKEN_PERSONAL = /\{personal\}/i;
const TOKEN_IMPORTANT = /\{important\}/i;
const TOKEN_DATE = /\{date:([^}]+)\}/i;
const TOKEN_ADDED = /\{added:(\d+)\}/i;
const MD_IMG = /!\[[^\]]*\]\(([^)]+)\)/;

const TRAILING_TOKEN_RES = [
  TOKEN_IMG,
  TOKEN_ATTACH,
  TOKEN_ATTACH_ALT,
  TOKEN_DATE,
  TOKEN_ADDED,
  TOKEN_IMPORTANT,
  TOKEN_WORK,
  TOKEN_PERSONAL,
  MD_IMG,
];

interface ItemTokens {
  image?: string;
  attachment?: string;
  category: PlanCategory;
  important: boolean;
  dueDate?: string;
  addedAt?: string;
}

export function parsePlanSection(content: string, todayYmd = todayDateString()): PlanItem[] {
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
    const { core, tokens } = splitBodyAndTokens(body);
    const parsed = parsePlanLine(core);

    items.push(
      enrichPlanItemMeta(
        enrichPlanItem({
          index,
          ...parsed,
          done,
          raw: line,
          category: tokens.category,
          important: tokens.important,
          dueDate: tokens.dueDate,
          addedAt: tokens.addedAt,
          image: tokens.image,
          attachment: tokens.attachment,
        }),
        todayYmd,
      ),
    );
    index++;
  }

  return items;
}

function splitBodyAndTokens(body: string): { core: string; tokens: ItemTokens } {
  let text = body.trim();
  const tokens: ItemTokens = { category: "personal", important: false };
  let changed = true;

  while (changed) {
    changed = false;
    for (const re of TRAILING_TOKEN_RES) {
      const match = text.match(re);
      if (!match) continue;

      if (re === TOKEN_IMG) tokens.image = imageBasename(match[1]!.trim());
      else if (re === TOKEN_ATTACH) tokens.attachment = match[1]!.trim();
      else if (re === TOKEN_ATTACH_ALT) tokens.attachment = match[1]!.trim();
      else if (re === TOKEN_DATE) tokens.dueDate = match[1]!.trim();
      else if (re === TOKEN_ADDED) tokens.addedAt = parseAddedToken(match[1]!.trim());
      else if (re === TOKEN_IMPORTANT) tokens.important = true;
      else if (re === TOKEN_WORK) tokens.category = "work";
      else if (re === TOKEN_PERSONAL) tokens.category = "personal";
      else if (re === MD_IMG) tokens.image = imageBasename(match[1]!.trim());

      text = text.replace(re, "").trim();
      changed = true;
      break;
    }
  }

  return { core: text.replace(/\s+/g, " ").trim(), tokens };
}

function parseAddedToken(raw: string): string | undefined {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const ms = raw.length >= 13 ? n : n * 1000;
  return new Date(ms).toISOString();
}

function serializeAddedAt(addedAt?: string): string | undefined {
  if (!addedAt) return undefined;
  const ms = new Date(addedAt).getTime();
  if (!Number.isFinite(ms)) return undefined;
  return String(ms);
}

function serializeTokens(tokens: ItemTokens): string {
  const parts: string[] = [];
  if (tokens.category === "work") parts.push("{work}");
  if (tokens.important) parts.push("{important}");
  if (tokens.dueDate) parts.push(`{date:${tokens.dueDate}}`);
  const added = serializeAddedAt(tokens.addedAt);
  if (added) parts.push(`{added:${added}}`);
  if (tokens.image) parts.push(`{img:${tokens.image}}`);
  if (tokens.attachment) parts.push(`{attach:${tokens.attachment}}`);
  return parts.join(" ");
}

function buildPlanBody(
  time: string | undefined,
  title: string,
  description: string | undefined,
  tokens: ItemTokens,
): string {
  let core = time?.trim() ? `${time.trim()} ` : "";
  core += title;
  if (description) core += ` — ${description}`;
  const suffix = serializeTokens(tokens);
  return suffix ? `${core} ${suffix}`.trim() : core.trim();
}

function imageBasename(path: string): string {
  const stripped = path
    .replace(/^uploads\/images\//i, "")
    .replace(/^images\//i, "")
    .replace(/^\/+/, "");
  const parts = stripped.split(/[/\\]/);
  return parts[parts.length - 1] ?? stripped;
}

function enrichPlanItem(item: PlanItem): PlanItem {
  const enriched = { ...item };
  if (item.image) Object.assign(enriched, mediaUrlsForImage(item.image));
  if (item.attachment) enriched.attachmentUrl = attachmentUrl(item.attachment);
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
  const today = todayDateString(date);
  const items = file.exists ? parsePlanSection(file.content, today) : [];
  const pending = sortPlanItems(items.filter((i) => !i.done), today);
  const done = sortPlanItems(items.filter((i) => i.done), today);

  return {
    date: today,
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
  const [plan, events] = await Promise.all([getPlan(), parseExtraEvents()]);
  const refs = new Set<string>();
  for (const item of plan.items) {
    if (item.image) refs.add(item.image);
  }
  for (const event of events) {
    if (event.image) refs.add(event.image);
  }
  return refs;
}

export async function updatePlanItem(
  index: number,
  updates: {
    done?: boolean;
    time?: string | null;
    dueDate?: string | null;
    category?: PlanCategory;
    important?: boolean;
  },
  date = new Date(),
): Promise<PlanResponse> {
  const path = planMemoryPath(date);
  const file = await readWorkspaceFile(path);

  if (!file.exists) throw new Error("Plan file does not exist");

  const lines = file.content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === PLAN_HEADER);
  if (start === -1) throw new Error("Plan section not found");

  let currentIndex = 0;
  let updated = false;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ") && line.trim() !== PLAN_HEADER) break;
    const match = line.match(CHECKBOX_RE);
    if (!match) continue;

    if (currentIndex === index) {
      const body = match[2]!.trim();
      const done = updates.done !== undefined ? updates.done : match[1]!.toLowerCase() === "x";
      const { core, tokens } = splitBodyAndTokens(body);
      const parsed = parsePlanLine(core);

      if (updates.category !== undefined) tokens.category = updates.category;
      if (updates.important !== undefined) tokens.important = updates.important;
      if (updates.dueDate === null) tokens.dueDate = undefined;
      else if (updates.dueDate !== undefined) tokens.dueDate = updates.dueDate.trim() || undefined;

      let time = parsed.time;
      if (updates.time === null) time = undefined;
      else if (updates.time !== undefined) time = updates.time.trim() || undefined;

      const newBody = buildPlanBody(time, parsed.title, parsed.description, tokens);
      lines[i] = `- [${done ? "x" : " "}] ${newBody}`;
      updated = true;
      break;
    }
    currentIndex++;
  }

  if (!updated) throw new Error("Plan item not found");

  await writeWorkspaceFile(path, lines.join("\n"));
  return getPlan(date);
}

export async function togglePlanItem(index: number, done: boolean, date = new Date()): Promise<PlanResponse> {
  return updatePlanItem(index, { done }, date);
}
