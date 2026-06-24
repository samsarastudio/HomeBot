import type { Request, Response, Router } from "express";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, extname } from "node:path";
import { resolveUploadFile, uploadsPath } from "../uploads.js";

const THUMB_SIZES = { small: 120, medium: 320, large: 640 } as const;

async function resizeWithSharp(
  input: string,
  output: string,
  size: number,
): Promise<boolean> {
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

  router.get("/thumb/:filename", async (req: Request, res: Response) => {
    const base = String(req.params.filename ?? "").replace(extname(String(req.params.filename ?? "")), "");
    const sizeKey = (String(req.query.size ?? "small") as keyof typeof THUMB_SIZES);
    const px = THUMB_SIZES[sizeKey] ?? THUMB_SIZES.small;

    const source = findImageFile(base);
    if (!source) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    const thumbDir = uploadsPath("thumbnails");
    if (!existsSync(thumbDir)) mkdirSync(thumbDir, { recursive: true });
    const cacheName = `${base}-${sizeKey}.webp`;
    const cachePath = join(thumbDir, cacheName);

    if (!existsSync(cachePath)) {
      const ok = await resizeWithSharp(source, cachePath, px);
      if (!ok) {
        res.sendFile(source);
        return;
      }
    }

    res.type("image/webp");
    res.send(readFileSync(cachePath));
  });
}
