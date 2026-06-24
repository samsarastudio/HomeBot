import type { Request, Response, Router } from "express";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { getArchiveStatus, listArchiveDate, purgeMedia, runArchive } from "../media/archive.js";
import { resolveUploadFile, uploadsPath } from "../uploads.js";

const THUMB_SIZES = { small: 120, medium: 320, large: 640 } as const;

async function resizeWithSharp(input: string, output: string, size: number): Promise<boolean> {
  try {
    const sharp = (await import("sharp")).default;
    await sharp(input).resize(size, size, { fit: "cover" }).webp({ quality: 80 }).toFile(output);
    return true;
  } catch {
    return false;
  }
}

function findImageFile(baseName: string): string | null {
  for (const ext of [".png", ".jpg", ".jpeg", ".gif", ".webp"]) {
    const full = resolveUploadFile("images", baseName + ext);
    if (full) return full;
  }
  const direct = resolveUploadFile("images", baseName);
  if (direct) return direct;
  return null;
}

function thumbCachePath(base: string, sizeKey: string, sourceMtime: number): string {
  return join(uploadsPath("thumbnails"), `${base}-${sizeKey}-${sourceMtime}.webp`);
}

export function registerMediaRoutes(router: Router): void {
  router.get("/image/:filename", (req: Request, res: Response) => {
    const filename = String(req.params.filename ?? "");
    const full = resolveUploadFile("images", filename) ?? findImageFile(filename.replace(extname(filename), ""));
    if (!full) {
      res.status(404).json({ error: "Image not found" });
      return;
    }
    res.sendFile(full);
  });

  router.get("/archive/:date/:filename", (req: Request, res: Response) => {
    const date = String(req.params.date ?? "");
    const filename = String(req.params.filename ?? "");
    const full = join(uploadsPath("archive", date), filename);
    if (!existsSync(full)) {
      res.status(404).json({ error: "Archived image not found" });
      return;
    }
    res.sendFile(full);
  });

  router.get("/thumb/:filename", async (req: Request, res: Response) => {
    const base = String(req.params.filename ?? "").replace(extname(String(req.params.filename ?? "")), "");
    const sizeKey = (String(req.query.size ?? "small") as keyof typeof THUMB_SIZES);
    const px = THUMB_SIZES[sizeKey] ?? THUMB_SIZES.small;

    const source = findImageFile(base);
    if (!source) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    const mtime = statSync(source).mtimeMs;
    const cachePath = thumbCachePath(base, sizeKey, mtime);

    if (!existsSync(cachePath)) {
      const thumbDir = uploadsPath("thumbnails");
      if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true });
      const ok = await resizeWithSharp(source, cachePath, px);
      if (!ok) {
        res.sendFile(source);
        return;
      }
    }

    res.type("image/webp");
    res.send(readFileSync(cachePath));
  });

  router.post("/archive", async (_req: Request, res: Response) => {
    try {
      res.json(await runArchive());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.get("/archive/status", (_req: Request, res: Response) => {
    res.json(getArchiveStatus());
  });

  router.get("/archive/list/:date", async (req: Request, res: Response) => {
    try {
      res.json(await listArchiveDate(String(req.params.date ?? "")));
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/purge", async (req: Request, res: Response) => {
    try {
      const body = req.body as {
        scope?: string;
        before?: string;
        confirm?: boolean;
        token?: string;
      };
      if (!body.scope || !["archive", "images", "all"].includes(body.scope)) {
        res.status(400).json({ error: "scope must be archive, images, or all" });
        return;
      }
      const result = await purgeMedia({
        scope: body.scope as "archive" | "images" | "all",
        before: body.before,
        confirm: body.confirm,
        token: body.token,
      });
      res.json(result);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });
}
