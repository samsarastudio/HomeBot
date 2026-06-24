import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import os from "node:os";
import { getStateRoot } from "./state-root.js";

export interface SystemMetrics {
  cpu: string;
  ram: string;
  disk: string;
}

export function readSystemMetrics(): SystemMetrics {
  return {
    cpu: readCpuUsage(),
    ram: readRamUsage(),
    disk: readDiskUsage(),
  };
}

function readRamUsage(): string {
  const total = os.totalmem();
  const free = os.freemem();
  const usedPct = total > 0 ? Math.round(((total - free) / total) * 100) : 0;
  return `${usedPct}%`;
}

let lastCpuIdle = 0;
let lastCpuTotal = 0;

function readCpuUsage(): string {
  if (process.platform === "linux") {
    try {
      const stat = readFileFirstLine("/proc/stat");
      const parts = stat.split(/\s+/);
      const idle = Number(parts[4] ?? 0) + Number(parts[5] ?? 0);
      const total = parts.slice(1, 8).reduce((sum, n) => sum + Number(n), 0);
      if (lastCpuTotal > 0) {
        const idleDelta = idle - lastCpuIdle;
        const totalDelta = total - lastCpuTotal;
        lastCpuIdle = idle;
        lastCpuTotal = total;
        if (totalDelta > 0) {
          const usage = Math.round((1 - idleDelta / totalDelta) * 100);
          return `${Math.max(0, Math.min(100, usage))}%`;
        }
      }
      lastCpuIdle = idle;
      lastCpuTotal = total;
    } catch {
      /* fall through */
    }
  }
  const load = os.loadavg()[0] ?? 0;
  const cores = os.cpus().length || 1;
  const pct = Math.min(100, Math.round((load / cores) * 100));
  return `${pct}%`;
}

function readDiskUsage(): string {
  try {
    if (process.platform === "win32") {
      const out = execSync("wmic logicaldisk where \"DeviceID='C:'\" get FreeSpace,Size /value", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const free = Number(out.match(/FreeSpace=(\d+)/)?.[1] ?? 0);
      const size = Number(out.match(/Size=(\d+)/)?.[1] ?? 0);
      if (size > 0) return `${Math.round((1 - free / size) * 100)}%`;
    } else {
      const out = execSync(`df -k "${getStateRoot()}" | tail -1`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      });
      const match = out.match(/(\d+)%/);
      if (match) return match[1] + "%";
    }
  } catch {
    /* ignore */
  }
  return "—";
}

function readFileFirstLine(path: string): string {
  return readFileSync(path, "utf8").split("\n")[0] ?? "";
}

export function readSessionCounts(): { active: number; total: number } {
  const sessionsDir = join(getStateRoot(), "sessions");
  if (!existsSync(sessionsDir)) {
    return { active: 0, total: 0 };
  }

  let total = 0;
  let active = 0;
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        total++;
        try {
          const mtime = statSync(full).mtimeMs;
          if (mtime >= oneDayAgo) active++;
        } catch {
          /* ignore */
        }
      }
    }
  };

  try {
    walk(sessionsDir);
  } catch {
    return { active: 0, total: 0 };
  }

  return { active, total };
}
