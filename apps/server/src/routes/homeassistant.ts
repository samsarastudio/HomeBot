import type { Request, Response, Router } from "express";
import { callHaService, fetchHaAreas, toggleHaArea } from "../homeassistant/areas.js";
import { getHaConfig, haPing } from "../homeassistant/client.js";

function parseAreaAction(action: unknown): "on" | "off" | "toggle" | undefined {
  if (action === "on" || action === "off" || action === "toggle") return action;
  return undefined;
}

async function handleAreaAction(
  req: Request,
  res: Response,
  forced?: "on" | "off" | "toggle",
): Promise<void> {
  const raw = req.params.areaId;
  const areaId = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!areaId) {
    res.status(400).json({ error: "areaId required" });
    return;
  }
  const action = forced ?? parseAreaAction((req.body as { action?: string })?.action) ?? "toggle";
  try {
    const result = await toggleHaArea(areaId, action);
    res.json({ ok: true, area_id: areaId, action: result.action, entity_ids: result.entity_ids });
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
}

export function registerHomeAssistantRoutes(router: Router): void {
  router.get("/status", async (_req: Request, res: Response) => {
    const cfg = getHaConfig();
    if (!cfg) {
      res.json({ configured: false, reachable: false });
      return;
    }
    res.json({ configured: true, reachable: await haPing() });
  });

  router.get("/areas", async (_req: Request, res: Response) => {
    try {
      res.json(await fetchHaAreas());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  router.post("/service", async (req: Request, res: Response) => {
    const { entity_id, action } = req.body as { entity_id?: string; action?: string };
    if (!entity_id?.trim()) {
      res.status(400).json({ error: "entity_id required" });
      return;
    }
    const act = action === "on" || action === "off" || action === "toggle" ? action : "toggle";
    try {
      await callHaService(entity_id.trim(), act);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  router.post("/areas/:areaId/toggle", (req, res) => void handleAreaAction(req, res, "toggle"));
  router.post("/areas/:areaId/on", (req, res) => void handleAreaAction(req, res, "on"));
  router.post("/areas/:areaId/off", (req, res) => void handleAreaAction(req, res, "off"));
  router.post("/areas/:areaId/service", (req, res) => void handleAreaAction(req, res));
}
