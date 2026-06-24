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
import { getPlan, togglePlanItem } from "./plan-file.js";
import { buildDashboardData } from "./routes/dashboard.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerMediaRoutes } from "./routes/media.js";
import { getUploadsRoot } from "./uploads.js";

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
      const { index, done } = req.body as { index?: number; done?: boolean };
      if (typeof index !== "number" || typeof done !== "boolean") {
        res.status(400).json({ error: "index and done are required" });
        return;
      }
      const plan = await togglePlanItem(index, done);
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

    setTimeout(() => {
      if (process.platform === "win32") {
        exec(`taskkill /F /FI "WINDOWTITLE eq HomeBot*"`, () => {});
      } else {
        const patterns = [
          `chromium.*--kiosk.*127.0.0.1:${port}`,
          `chromium.*127.0.0.1:${port}`,
          `chromium.*localhost:${port}`,
          `chrome.*127.0.0.1:${port}`,
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
    void broadcastDashboard(io);
    socket.on("disconnect", () => {});
  });

  setInterval(() => void broadcastDashboard(io), REFRESH_MS);

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.log(`HomeBot API listening on http://127.0.0.1:${PORT}`);
    console.log(`Uploads: ${getUploadsRoot()}`);
    console.log(`Socket.IO: dashboard:update every ${REFRESH_MS}ms`);
  });
}
