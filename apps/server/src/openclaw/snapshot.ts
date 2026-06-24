import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { OpenClawStatus } from "@homebot/shared";
import { readCronJobs } from "./cron.js";
import { getStateRoot } from "./state-root.js";
import { readTasks } from "./tasks.js";
import { getPlan } from "../plan-file.js";

async function readConfig(): Promise<{ cronEnabled?: boolean; agentName?: string; port: number }> {
  const configPath = join(getStateRoot(), "openclaw.json");
  const port = Number(process.env.OPENCLAW_GATEWAY_PORT ?? 18789);

  try {
    const raw = await readFile(configPath, "utf8");
    const json = JSON.parse(raw) as {
      cron?: { enabled?: boolean };
      gateway?: { port?: number };
      agents?: { defaults?: { workspace?: string } };
    };
    return {
      cronEnabled: json.cron?.enabled,
      agentName: json.agents?.defaults?.workspace?.split("/").pop(),
      port: json.gateway?.port ?? port,
    };
  } catch {
    return { port };
  }
}

async function checkGatewayReachable(port: number): Promise<boolean> {
  const cacheMs = Number(process.env.HOMEBOT_GATEWAY_CACHE_MS ?? 10_000);
  const now = Date.now();
  if (gatewayCache && now - gatewayCache.at < cacheMs) {
    return gatewayCache.reachable;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`http://127.0.0.1:${port}/`, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const reachable = res.ok || res.status === 401 || res.status === 404;
    gatewayCache = { reachable, at: now };
    return reachable;
  } catch {
    gatewayCache = { reachable: false, at: now };
    return false;
  }
}

let gatewayCache: { reachable: boolean; at: number } | null = null;

export async function buildStatusSnapshot(): Promise<OpenClawStatus> {
  const stateDir = getStateRoot();
  const config = await readConfig();
  const [cronJobs, tasks, plan, gatewayReachable] = await Promise.all([
    readCronJobs(),
    readTasks(),
    getPlan(),
    checkGatewayReachable(config.port),
  ]);

  return {
    stateDir,
    gateway: {
      reachable: gatewayReachable,
      port: config.port,
    },
    config: {
      cronEnabled: config.cronEnabled,
      agentName: config.agentName,
    },
    cron: {
      total: cronJobs.length,
      enabled: cronJobs.filter((j) => j.enabled).length,
      jobs: cronJobs,
    },
    tasks,
    plan: {
      total: plan.total,
      done: plan.doneCount,
    },
  };
}
