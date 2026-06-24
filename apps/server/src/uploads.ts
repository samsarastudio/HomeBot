import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getStateRoot } from "./openclaw/state-root.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_ROOT = join(__dirname, "..", "..");

export function getUploadsRoot(): string {
  const fromEnv = process.env.HOMEBOT_UPLOADS_DIR?.trim();
  if (fromEnv) {
    ensureUploadDirs(fromEnv);
    return fromEnv;
  }

  try {
    const stateUploads = join(getStateRoot(), "uploads");
    if (existsSync(join(getStateRoot(), "openclaw.json")) || existsSync(stateUploads)) {
      ensureUploadDirs(stateUploads);
      return stateUploads;
    }
  } catch {
    /* fall through */
  }

  const fallback = join(API_ROOT, "uploads");
  ensureUploadDirs(fallback);
  return fallback;
}

function ensureUploadDirs(root: string): void {
  for (const sub of ["images", "attachments", "thumbnails"]) {
    const dir = join(root, sub);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function uploadsPath(...parts: string[]): string {
  return join(getUploadsRoot(), ...parts);
}

export function resolveUploadFile(dir: string, filename: string): string | null {
  const safeName = filename.replace(/[/\\]/g, "").replace(/\.\./g, "");
  if (!safeName || safeName !== filename) return null;
  const full = join(getUploadsRoot(), dir, safeName);
  const root = getUploadsRoot();
  if (!full.startsWith(root)) return null;
  if (!existsSync(full)) return null;
  return full;
}
