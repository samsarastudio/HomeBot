import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import express from "express";
import { Server as SocketServer } from "socket.io";
import { buildStatusSnapshot } from "./openclaw/snapshot.js";
import { readCronJobs } from "./openclaw/cron.js";
import { readTasks } from "./openclaw/tasks.js";
import { listWorkspace, readWorkspaceFile } from "./openclaw/workspace.js";
import { getPlan, updatePlanItem, addPlanItem, deletePlanItem, deferPlanItemToTomorrow } from "./plan-file.js";
import { buildDashboardData } from "./routes/dashboard.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerMediaRoutes } from "./routes/media.js";
import { registerNotificationRoutes } from "./routes/notifications.js";
import { getUploadsRoot } from "./uploads.js";
import { tickEventScheduler } from "./events/scheduler.js";
import { runArchive, getArchiveStatus } from "./media/archive.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const PORT = Number(process.env.HOMEBOT_PORT ?? 8080);
const REFRESH_MS = Number(process.env.HOMEBOT_REFRESH_MS ?? 5000);

let dashboardIo: SocketServer | null = null;

export function getDashboardIo(): SocketServer | null {
  return dashboardIo;
}

function resolveDashboardDist(): string {
  const candidates = [
    join(__dirname, "..", "..", "dashboard", "dist"),
    join(__dirname, "..", "dashboard", "dist"),
    join(process.cwd(), "apps", "dashboard", "dist"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "index.html"))) return c;
  }
  return candidates[0]!;
}

export async function broadcastDashboard(io: SocketServer): Promise<void> {
  try {
    const data = await buildDashboardData();
    io.emit("dashboard:update", data);
  } catch {
    /* ignore broadcast errors */
  }
}

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  app.get("/api/dashboard/data", async (_req, res) => {
    try {
      res.json(await buildDashboardData());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  const filesRouter = express.Router();
  registerFileRoutes(filesRouter);
  app.use("/api/files", filesRouter);

  const mediaRouter = express.Router();
  registerMediaRoutes(mediaRouter);
  app.use("/api/media", mediaRouter);

  const notificationsRouter = express.Router();
  registerNotificationRoutes(notificationsRouter);
  app.use("/api/notifications", notificationsRouter);

  app.get("/api/openclaw/status", async (_req, res) => {
    try {
      res.json(await buildStatusSnapshot());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/openclaw/workspace", async (req, res) => {
    try {
      const path = String(req.query.path ?? "");
      if (!path) {
        const entries = await listWorkspace(String(req.query.dir ?? ""));
        res.json({ entries });
        return;
      }
      const file = await readWorkspaceFile(path);
      res.json(file);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.get("/api/openclaw/cron", async (_req, res) => {
    try {
      const jobs = await readCronJobs();
      res.json({ jobs });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/openclaw/tasks", async (_req, res) => {
    try {
      res.json(await readTasks());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.get("/api/plan", async (_req, res) => {
    try {
      res.json(await getPlan());
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  app.put("/api/plan", async (req, res) => {
    try {
      const { index, done, time, dueDate, category, important, title, description } = req.body as {
        index?: number;
        done?: boolean;
        time?: string | null;
        dueDate?: string | null;
        category?: "work" | "personal";
        important?: boolean;
        title?: string;
        description?: string | null;
      };
      if (typeof index !== "number") {
        res.status(400).json({ error: "index is required" });
        return;
      }
      const updates: {
        done?: boolean;
        time?: string | null;
        dueDate?: string | null;
        category?: "work" | "personal";
        important?: boolean;
        title?: string;
        description?: string | null;
      } = {};
      if (typeof done === "boolean") updates.done = done;
      if (time !== undefined) updates.time = time;
      if (dueDate !== undefined) updates.dueDate = dueDate;
      if (category === "work" || category === "personal") updates.category = category;
      if (typeof important === "boolean") updates.important = important;
      if (title !== undefined) updates.title = title;
      if (description !== undefined) updates.description = description;
      if (Object.keys(updates).length === 0) {
        res.status(400).json({ error: "no updates provided" });
        return;
      }
      const plan = await updatePlanItem(index, updates);
      const io = getDashboardIo();
      if (io) void broadcastDashboard(io);
      res.json(plan);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/plan", async (req, res) => {
    try {
      const { title, description, time, dueDate, category, important } = req.body as {
        title?: string;
        description?: string;
        time?: string;
        dueDate?: string;
        category?: "work" | "personal";
        important?: boolean;
      };
      if (!title?.trim()) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      const plan = await addPlanItem({
        title: title.trim(),
        description: description?.trim(),
        time: time?.trim(),
        dueDate: dueDate?.trim(),
        category: category === "work" ? "work" : "personal",
        important: Boolean(important),
      });
      const io = getDashboardIo();
      if (io) void broadcastDashboard(io);
      res.json(plan);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.delete("/api/plan/:index", async (req, res) => {
    try {
      const index = Number(req.params.index);
      if (!Number.isFinite(index)) {
        res.status(400).json({ error: "invalid index" });
        return;
      }
      const plan = await deletePlanItem(index);
      const io = getDashboardIo();
      if (io) void broadcastDashboard(io);
      res.json(plan);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/plan/defer", async (req, res) => {
    try {
      const { index } = req.body as { index?: number };
      if (typeof index !== "number") {
        res.status(400).json({ error: "index is required" });
        return;
      }
      const plan = await deferPlanItemToTomorrow(index);
      const io = getDashboardIo();
      if (io) void broadcastDashboard(io);
      res.json(plan);
    } catch (err) {
      res.status(400).json({ error: String(err) });
    }
  });

  app.post("/api/exit", (_req, res) => {
    res.json({ ok: true });
    const port = PORT;
    const profile = process.env.HOMEBOT_KIOSK_PROFILE?.trim() || `${process.env.HOME || "/home/pi"}/.config/homebot-kiosk`;

    setTimeout(() => {
      if (process.platform === "win32") {
        exec(`taskkill /F /FI "WINDOWTITLE eq HomeBot*"`, () => {});
      } else {
        const patterns = [
          `user-data-dir=${profile}`,
          `chromium.*--kiosk.*127.0.0.1:${port}`,
          `chromium.*127.0.0.1:${port}`,
          `chromium.*localhost:${port}`,
        ];
        for (const p of patterns) {
          exec(`pkill -f "${p}"`, () => {});
        }
        exec(`wmctrl -c "HomeBot"`, () => {});
      }
    }, 100);
  });

  const dist = resolveDashboardDist();
  app.use(express.static(dist));
  app.use((_req, res) => {
    res.sendFile(join(dist, "index.html"));
  });

  return app;
}

export function startServer(): void {
  getUploadsRoot();
  const app = createApp();
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, { cors: { origin: "*" } });
  dashboardIo = io;

  io.on("connection", (socket) => {
    void broadcastDashboard(io!);
    void tickEventScheduler(io);
    socket.on("disconnect", () => {});
  });

  setInterval(() => void broadcastDashboard(io), REFRESH_MS);
  setInterval(() => void tickEventScheduler(io), 30_000);

  const archiveEnabled = process.env.HOMEBOT_ARCHIVE_ENABLED !== "false";
  if (archiveEnabled) {
    const scheduleArchive = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const status = getArchiveStatus();
      const lastRun = status.lastRun ? new Date(status.lastRun) : null;
      const sameDay = lastRun && lastRun.toDateString() === now.toDateString();

      if (hour === 0 && minute < 2 && !sameDay) {
        void runArchive();
      }
    };
    setInterval(scheduleArchive, 60_000);
  }

  void tickEventScheduler(io);

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`HomeBot API listening on http://127.0.0.1:${PORT}`);
    console.log(`Uploads: ${getUploadsRoot()}`);
    console.log(`Socket.IO: dashboard:update every ${REFRESH_MS}ms`);
  });
}
