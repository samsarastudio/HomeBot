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
const TOKEN_FROM = /\{from:([^}]+)\}/i;
const TOKEN_CARRIED = /\{carried:([^}]+)\}/i;
const MD_IMG = /!\[[^\]]*\]\(([^)]+)\)/;

const TRAILING_TOKEN_RES = [
  TOKEN_IMG,
  TOKEN_ATTACH,
  TOKEN_ATTACH_ALT,
  TOKEN_DATE,
  TOKEN_ADDED,
  TOKEN_FROM,
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
  carryFrom?: string;
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
          carryFrom: tokens.carryFrom,
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
      else if (re === TOKEN_FROM) tokens.carryFrom = match[1]!.trim();
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
  if (tokens.carryFrom) parts.push(`{from:${tokens.carryFrom}}`);
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

export interface PlanLineFields {
  time?: string;
  title: string;
  description?: string;
  category?: PlanCategory;
  important?: boolean;
  dueDate?: string;
  addedAt?: string;
  carryFrom?: string;
  image?: string;
  attachment?: string;
}

export function buildPlanLine(fields: PlanLineFields, done: boolean): string {
  const tokens: ItemTokens = {
    category: fields.category ?? "personal",
    important: fields.important ?? false,
    dueDate: fields.dueDate,
    addedAt: fields.addedAt,
    carryFrom: fields.carryFrom,
    image: fields.image,
    attachment: fields.attachment,
  };
  const body = buildPlanBody(fields.time, fields.title, fields.description, tokens);
  return `- [${done ? "x" : " "}] ${body}`;
}

export function planSectionLines(content: string): string[] {
  return content.split(/\r?\n/);
}

export function markPlanItemCarried(content: string, index: number, toDate: string): string | null {
  const lines = planSectionLines(content);
  const start = lines.findIndex((l) => l.trim() === PLAN_HEADER);
  if (start === -1) return null;

  let currentIndex = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith("## ") && line.trim() !== PLAN_HEADER) break;
    const match = line.match(CHECKBOX_RE);
    if (!match) continue;

    if (currentIndex === index) {
      if (TOKEN_CARRIED.test(line)) return null;
      lines[i] = `${line.trimEnd()} {carried:${toDate}}`;
      return lines.join("\n");
    }
    currentIndex++;
  }

  return null;
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

const CARRY_LOOKBACK_DAYS = 14;

function addDays(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + delta);
}

function carryIdentity(carryFrom: string, title: string): string {
  return `${carryFrom}:${title.trim().toLowerCase()}`;
}

async function ensureTodayPlanFile(date: Date): Promise<string> {
  const path = planMemoryPath(date);
  const file = await readWorkspaceFile(path);
  const todayStr = todayDateString(date);
  if (file.exists) return file.content;
  const content = `# ${todayStr}\n\n## Plan\n`;
  await writeWorkspaceFile(path, content);
  return content;
}

function appendPlanLines(content: string, newLines: string[]): string {
  const lines = content.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === PLAN_HEADER);
  if (start === -1) return `${content.trimEnd()}\n\n## Plan\n${newLines.join("\n")}\n`;

  let insertAt = start + 1;
  while (insertAt < lines.length && !lines[insertAt]!.startsWith("## ")) insertAt++;
  lines.splice(insertAt, 0, ...newLines);
  return lines.join("\n");
}

async function ensureCarryForward(date = new Date()): Promise<void> {
  const todayStr = todayDateString(date);
  let todayContent = await ensureTodayPlanFile(date);
  const todayItems = parsePlanSection(todayContent, todayStr);
  const existing = new Set(
    todayItems.map((i) => carryIdentity(i.carryFrom ?? todayStr, i.title)),
  );

  const newLines: string[] = [];
  const sourceWrites = new Map<string, string>();

  for (let back = 1; back <= CARRY_LOOKBACK_DAYS; back++) {
    const srcDate = addDays(date, -back);
    const srcStr = todayDateString(srcDate);
    const srcPath = planMemoryPath(srcDate);
    const srcFile = await readWorkspaceFile(srcPath);
    if (!srcFile.exists) continue;

    let srcContent = srcFile.content;
    const srcItems = parsePlanSection(srcContent, srcStr);

    for (const item of srcItems) {
      if (item.done || TOKEN_CARRIED.test(item.raw)) continue;

      const fromDate = item.carryFrom ?? srcStr;
      const id = carryIdentity(fromDate, item.title);
      if (existing.has(id)) continue;

      newLines.push(
        buildPlanLine(
          {
            time: item.time,
            title: item.title,
            description: item.description,
            category: item.category,
            important: item.important,
            dueDate: item.dueDate,
            addedAt: item.addedAt,
            carryFrom: fromDate,
            image: item.image,
            attachment: item.attachment,
          },
          false,
        ),
      );
      existing.add(id);

      const marked = markPlanItemCarried(srcContent, item.index, todayStr);
      if (marked) {
        srcContent = marked;
        sourceWrites.set(srcPath, marked);
      }
    }
  }

  if (newLines.length > 0) {
    todayContent = appendPlanLines(todayContent, newLines);
    await writeWorkspaceFile(planMemoryPath(date), todayContent);
  }

  for (const [path, content] of sourceWrites) {
    await writeWorkspaceFile(path, content);
  }
}

export async function getPlan(date = new Date()): Promise<PlanResponse> {
  await ensureCarryForward(date);

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
      // carryFrom preserved from existing tokens

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
