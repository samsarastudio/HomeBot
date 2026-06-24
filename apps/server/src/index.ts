import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { buildStatusSnapshot } from "./openclaw/snapshot.js";
import { readCronJobs } from "./openclaw/cron.js";
import { readTasks } from "./openclaw/tasks.js";
import { listWorkspace, readWorkspaceFile } from "./openclaw/workspace.js";
import { getPlan, togglePlanItem } from "./plan-file.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.HOMEBOT_PORT ?? 8080);

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

const app = express();
app.use(express.json());

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
    res.json(await togglePlanItem(index, done));
  } catch (err) {
    res.status(400).json({ error: String(err) });
  }
});

app.post("/api/exit", (_req, res) => {
  res.json({ ok: true });

  const port = PORT;
  const patterns = [
    `chromium.*127.0.0.1:${port}`,
    `chromium.*localhost:${port}`,
    `chrome.*127.0.0.1:${port}`,
  ];

  setTimeout(() => {
    if (process.platform === "win32") {
      for (const p of patterns) {
        exec(`taskkill /F /FI "WINDOWTITLE eq HomeBot*"`, () => {});
      }
      try {
        // Browser opened by user can close itself via window.close when allowed
      } catch {
        /* ignore */
      }
    } else {
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

app.listen(PORT, "127.0.0.1", () => {
  console.log(`HomeBot server listening on http://127.0.0.1:${PORT}`);
  console.log(`Serving dashboard from ${dist}`);
});
