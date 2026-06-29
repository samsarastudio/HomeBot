import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface HaConfig {
  url: string;
  token: string;
}

export interface HaConfigMeta {
  url: string;
  tokenConfigured: boolean;
  tokenSource: "env" | "file" | "none";
  tokenPath?: string;
}

export function getHaConfigMeta(): HaConfigMeta {
  const url = (process.env.HOMEBOT_HA_URL ?? "http://127.0.0.1:8123").replace(/\/$/, "");
  const envToken = process.env.HOMEBOT_HA_TOKEN?.trim();
  if (envToken) {
    return { url, tokenConfigured: true, tokenSource: "env" };
  }

  const candidates = [
    join(process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw"), "secrets", "ha-token"),
    join(homedir(), ".openclaw", "secrets", "ha-token"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      const token = readFileSync(p, "utf8").trim();
      if (token) return { url, tokenConfigured: true, tokenSource: "file", tokenPath: p };
    }
  }

  return { url, tokenConfigured: false, tokenSource: "none" };
}

export function getHaConfig(): HaConfig | null {
  const meta = getHaConfigMeta();
  if (!meta.tokenConfigured) return null;

  let token = process.env.HOMEBOT_HA_TOKEN?.trim();
  if (!token && meta.tokenPath && existsSync(meta.tokenPath)) {
    token = readFileSync(meta.tokenPath, "utf8").trim();
  }
  if (!token) return null;
  return { url: meta.url, token };
}

export async function haFetch(path: string, init?: RequestInit): Promise<Response> {
  const cfg = getHaConfig();
  if (!cfg) throw new Error("Home Assistant not configured (set HOMEBOT_HA_TOKEN or ~/.openclaw/secrets/ha-token)");

  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${cfg.token}`);
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(`${cfg.url}${path}`, { ...init, headers });
}

export async function haPing(): Promise<boolean> {
  try {
    const res = await haFetch("/api/");
    return res.ok;
  } catch {
    return false;
  }
}
