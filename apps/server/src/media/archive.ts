import { existsSync, mkdirSync } from "node:fs";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, extname } from "node:path";
import type { ArchiveStatus } from "@homebot/shared";
import { getReferencedMediaFilenames } from "../plan-file.js";
import { getUploadsRoot, uploadsPath } from "../uploads.js";
import { imageBaseName } from "./urls.js";
import { todayDateString } from "../openclaw/state-root.js";

let lastStatus: ArchiveStatus = {};

export function getArchiveStatus(): ArchiveStatus {
  return { ...lastStatus };
}

async function compressImage(input: string, output: string, maxPx: number, quality: number): Promise<void> {
  const sharp = (await import("sharp")).default;
  await sharp(input)
    .resize(maxPx, maxPx, { fit: "inside", withoutEnlargement: true })
    .webp({ quality })
    .toFile(output);
}

export async function runArchive(options?: { beforeDate?: string }): Promise<ArchiveStatus> {
  const enabled = process.env.HOMEBOT_ARCHIVE_ENABLED !== "false";
  if (!enabled) {
    lastStatus = { lastRun: new Date().toISOString(), lastError: "archive disabled" };
    return lastStatus;
  }

  const maxPx = Number(process.env.HOMEBOT_ARCHIVE_MAX_PX ?? 640);
  const quality = Number(process.env.HOMEBOT_ARCHIVE_QUALITY ?? 50);
  const beforeDate = options?.beforeDate ?? todayDateString();
  const archiveDir = uploadsPath("archive", beforeDate);
  const imagesDir = uploadsPath("images");
  const referenced = await getReferencedMediaFilenames();

  if (!existsSync(archiveDir)) mkdirSync(archiveDir, { recursive: true });

  let bytesSaved = 0;
  let filesArchived = 0;
  const manifest: Array<Record<string, unknown>> = [];

  try {
    const names = await readdir(imagesDir);
    const cutoff = new Date(`${beforeDate}T23:59:59`).getTime();

    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = join(imagesDir, name);
      const info = await stat(full);
      if (!info.isFile()) continue;

      if (referenced.has(name)) continue;
      if (info.mtimeMs > cutoff) continue;

      const archivedName = `${imageBaseName(name)}.webp`;
      const outPath = join(archiveDir, archivedName);
      const originalBytes = info.size;

      await compressImage(full, outPath, maxPx, quality);
      const archivedStat = await stat(outPath);
      await unlink(full);

      const thumbPath = join(uploadsPath("thumbnails"), `${imageBaseName(name)}-small.webp`);
      if (existsSync(thumbPath)) await unlink(thumbPath).catch(() => {});

      bytesSaved += Math.max(0, originalBytes - archivedStat.size);
      filesArchived++;
      manifest.push({
        original: name,
        archived: archivedName,
        originalBytes,
        archivedBytes: archivedStat.size,
        deletedOriginal: true,
      });
    }

    await writeFile(
      join(archiveDir, "manifest.json"),
      JSON.stringify({ date: beforeDate, files: manifest }, null, 2),
      "utf8",
    );

    lastStatus = {
      lastRun: new Date().toISOString(),
      lastBytesSaved: bytesSaved,
      lastFilesArchived: filesArchived,
    };
  } catch (err) {
    lastStatus = {
      lastRun: new Date().toISOString(),
      lastError: String(err),
      lastBytesSaved: bytesSaved,
      lastFilesArchived: filesArchived,
    };
  }

  return lastStatus;
}

export interface PurgeRequest {
  scope: "archive" | "images" | "all";
  before?: string;
  confirm?: boolean;
  token?: string;
}

export interface PurgeSummary {
  scope: string;
  before?: string;
  files: string[];
  totalBytes: number;
  needsConfirm: boolean;
}

async function collectArchiveFiles(before?: string): Promise<{ files: string[]; totalBytes: number }> {
  const archiveRoot = uploadsPath("archive");
  if (!existsSync(archiveRoot)) return { files: [], totalBytes: 0 };

  const files: string[] = [];
  let totalBytes = 0;
  const dirs = await readdir(archiveRoot);

  for (const dir of dirs) {
    if (before && dir > before) continue;
    const fullDir = join(archiveRoot, dir);
    const entries = await readdir(fullDir);
    for (const entry of entries) {
      const full = join(fullDir, entry);
      const info = await stat(full);
      if (info.isFile()) {
        files.push(full);
        totalBytes += info.size;
      }
    }
  }

  return { files, totalBytes };
}

export async function purgeMedia(req: PurgeRequest): Promise<PurgeSummary | { ok: true; deleted: number }> {
  const purgeToken = process.env.HOMEBOT_PURGE_TOKEN?.trim();

  if (req.scope === "all" && req.confirm) {
    if (purgeToken && req.token !== purgeToken) {
      throw new Error("Invalid purge token");
    }
  }

  if (req.scope === "archive" || req.scope === "all") {
    const { files, totalBytes } = await collectArchiveFiles(req.before);
    if (!req.confirm) {
      return { scope: req.scope, before: req.before, files: files.map((f) => f.replace(getUploadsRoot(), "")), totalBytes, needsConfirm: true };
    }
    for (const f of files) await unlink(f).catch(() => {});
    if (req.scope === "archive") return { ok: true, deleted: files.length };
  }

  if (req.scope === "images" || req.scope === "all") {
    const imagesDir = uploadsPath("images");
    const names = existsSync(imagesDir) ? await readdir(imagesDir) : [];
    const files: string[] = [];
    let totalBytes = 0;
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const full = join(imagesDir, name);
      const info = await stat(full);
      if (!info.isFile()) continue;
      files.push(full);
      totalBytes += info.size;
    }
    if (!req.confirm) {
      return { scope: req.scope, files: files.map((f) => f.replace(getUploadsRoot(), "")), totalBytes, needsConfirm: true };
    }
    for (const f of files) await unlink(f).catch(() => {});
    return { ok: true, deleted: files.length };
  }

  return { scope: req.scope, files: [], totalBytes: 0, needsConfirm: true };
}

export async function listArchiveDate(date: string): Promise<unknown> {
  const manifestPath = join(uploadsPath("archive", date), "manifest.json");
  if (!existsSync(manifestPath)) return { date, files: [] };
  const raw = await readFile(manifestPath, "utf8");
  return JSON.parse(raw);
}
