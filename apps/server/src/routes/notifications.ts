import type { Request, Response, Router } from "express";
import { dismissNotification, getPendingNotifications, markNotificationDismissed, snoozeNotification } from "../events/scheduler.js";

export function registerNotificationRoutes(router: Router): void {
  router.get("/pending", (_req: Request, res: Response) => {
    res.json({ notifications: getPendingNotifications() });
  });

  router.post("/dismiss", (req: Request, res: Response) => {
    const { id } = req.body as { id?: string };
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }
    markNotificationDismissed(id);
    dismissNotification(id);
    res.json({ ok: true });
  });

  router.post("/snooze", (req: Request, res: Response) => {
    const { id, minutes } = req.body as { id?: string; minutes?: number };
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }
    snoozeNotification(id, minutes ?? 5);
    dismissNotification(id);
    res.json({ ok: true });
  });
}
