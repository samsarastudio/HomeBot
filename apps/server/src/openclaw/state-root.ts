import { homedir } from "node:os";
import { join, resolve, relative, isAbsolute } from "node:path";

export function getStateRoot(): string {
  const fromEnv = process.env.OPENCLAW_STATE_DIR?.trim();
  if (fromEnv) return resolve(fromEnv);
  const home = process.env.OPENCLAW_HOME?.trim() || homedir();
  return join(home, ".openclaw");
}

export function getWorkspaceRoot(): string {
  return join(getStateRoot(), "workspace");
}

export function assertInsideRoot(root: string, targetPath: string): string {
  const resolvedRoot = resolve(root);
  const resolved = resolve(root, targetPath);
  const rel = relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path escapes workspace root");
  }
  return resolved;
}

export function todayDateString(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
