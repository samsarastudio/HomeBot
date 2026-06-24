import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { resolveUploadFile, uploadsPath } from "../uploads.js";

export function imageBaseName(filename: string): string {
  return filename.replace(extname(filename), "");
}

function findImageFile(baseName: string): string | null {
  for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp"]) {
    const full = resolveUploadFile("images", baseName + ext);
    if (full) return full;
  }
  return resolveUploadFile("images", baseName);
}

function findInArchive(original: string): { date: string; archived: string } | null {
  const archiveRoot = uploadsPath("archive");
  if (!existsSync(archiveRoot)) return null;

  for (const date of readdirSync(archiveRoot)) {
    const manifestPath = join(archiveRoot, date, "manifest.json");
    if (!existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
        files?: Array<{ original?: string; archived?: string }>;
      };
      for (const entry of manifest.files ?? []) {
        if (entry.original === original && entry.archived) {
          return { date, archived: entry.archived };
        }
      }
    } catch {
      /* skip bad manifest */
    }
  }
  return null;
}

export function mediaUrlsForImage(filename: string): {
  thumbUrl: string;
  imageUrl: string;
  archivedImageUrl?: string;
} {
  const base = imageBaseName(filename);
  const hasOriginal = Boolean(findImageFile(base) ?? findImageFile(filename));

  if (hasOriginal) {
    return {
      thumbUrl: `/api/media/thumb/${encodeURIComponent(base)}?size=small`,
      imageUrl: `/api/media/image/${encodeURIComponent(filename)}`,
    };
  }

  const archived = findInArchive(filename);
  if (archived) {
    const url = archivedImageUrl(archived.date, archived.archived);
    return { thumbUrl: url, imageUrl: url, archivedImageUrl: url };
  }

  return {
    thumbUrl: `/api/media/thumb/${encodeURIComponent(base)}?size=small`,
    imageUrl: `/api/media/image/${encodeURIComponent(filename)}`,
  };
}

export function attachmentUrl(filename: string): string {
  return `/api/files/get/${encodeURIComponent(filename)}`;
}

export function archivedImageUrl(date: string, archivedName: string): string {
  return `/api/media/archive/${encodeURIComponent(date)}/${encodeURIComponent(archivedName)}`;
}
