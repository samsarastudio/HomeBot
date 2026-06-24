import type { Request, Response, Router } from "express";
import { readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import type { FileListItem } from "@homebot/shared";
import { getUploadsRoot, resolveUploadFile } from "../uploads.js";
import { readWorkspaceFile, listWorkspace } from "../openclaw/workspace.js";

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const DOC_EXT = new Set([".md", ".txt", ".json", ".pdf", ".csv"]);

function fileType(name: string): FileListItem["type"] {
  const ext = extname(name).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  if (DOC_EXT.has(ext)) return "document";
  return "attachment";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

async function listUploadDir(subdir: string): Promise<FileListItem[]> {
  const dir = join(getUploadsRoot(), subdir);
  try {
    const names = await readdir(dir);
    const items: FileListItem[] = [];
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const info = await stat(join(dir, name));
      if (!info.isFile()) continue;
      const type = fileType(name);
      const item: FileListItem = {
        name,
        type,
        size: formatSize(info.size),
        url: type === "image"
          ? `/api/media/image/${encodeURIComponent(name)}`
          : `/api/files/get/${encodeURIComponent(name)}`,
      };
      if (type === "image") {
        const base = name.replace(extname(name), "");
        item.thumbUrl = `/api/media/thumb/${encodeURIComponent(base)}?size=small`;
      }
      items.push(item);
    }
    return items.sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function registerFileRoutes(router: Router): void {
  router.get("/list", async (req: Request, res: Response) => {
    try {
      const dir = String(req.query.dir ?? "uploads");
      if (dir === "uploads" || dir === "images") {
        res.json(await listUploadDir("images"));
        return;
      }
      if (dir === "attachments") {
        res.json(await listUploadDir("attachments"));
        return;
      }
      if (dir.startsWith("workspace")) {
        const sub = dir.replace(/^workspace\/?/, "");
        const entries = await listWorkspace(sub);
        const items: FileListItem[] = entries
          .filter((e) => e.type === "file")
          .map((e) => ({
            name: e.name,
            type: fileType(e.name),
            size: e.size ? formatSize(e.size) : "—",
            url: `/api/openclaw/workspace?path=${encodeURIComponent(e.path)}`,
          }));
        res.json(items);
        return;
      }
      res.json(await listUploadDir("attachments"));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/get/:filename", async (req: Request, res: Response) => {
    try {
      const filename = String(req.params.filename ?? "");
      let full = resolveUploadFile("attachments", filename);
      if (!full) full = resolveUploadFile("images", filename);
      if (full) {
        res.sendFile(full);
        return;
      }
      const ws = await readWorkspaceFile(filename);
      if (ws.exists) {
        res.type("text/plain").send(ws.content);
        return;
      }
      res.status(404).json({ error: "File not found" });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });
}
