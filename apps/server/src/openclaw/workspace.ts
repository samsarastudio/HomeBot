import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { assertInsideRoot, getWorkspaceRoot } from "./state-root.js";

export async function readWorkspaceFile(relativePath: string): Promise<{ path: string; content: string; exists: boolean }> {
  const root = getWorkspaceRoot();
  const full = assertInsideRoot(root, relativePath);
  try {
    const content = await readFile(full, "utf8");
    return { path: relativePath.replace(/\\/g, "/"), content, exists: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { path: relativePath.replace(/\\/g, "/"), content: "", exists: false };
    }
    throw err;
  }
}

export async function writeWorkspaceFile(relativePath: string, content: string): Promise<void> {
  const root = getWorkspaceRoot();
  const full = assertInsideRoot(root, relativePath);
  await writeFile(full, content, "utf8");
}

export interface WorkspaceEntry {
  path: string;
  name: string;
  type: "file" | "directory";
  size?: number;
}

export async function listWorkspace(relativeDir = ""): Promise<WorkspaceEntry[]> {
  const root = getWorkspaceRoot();
  const full = assertInsideRoot(root, relativeDir || ".");
  const entries = await readdir(full, { withFileTypes: true });
  const result: WorkspaceEntry[] = [];

  for (const entry of entries) {
    const entryPath = join(relativeDir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      result.push({ path: entryPath, name: entry.name, type: "directory" });
    } else if (entry.isFile()) {
      const info = await stat(join(full, entry.name));
      result.push({ path: entryPath, name: entry.name, type: "file", size: info.size });
    }
  }

  return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function workspaceRelativePath(absolutePath: string): string {
  const root = getWorkspaceRoot();
  return relative(root, absolutePath).replace(/\\/g, "/");
}
