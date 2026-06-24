import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const API_ROOT = join(__dirname, "..", "..");

export function getUploadsRoot(): string {
  const fromEnv = process.env.HOMEBOT_UPLOADS_DIR?.trim();
  const root = fromEnv ? fromEnv : join(API_ROOT, "uploads");
  ensureUploadDirs(root);
  return root;
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
