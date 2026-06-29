import { existsSync } from "node:fs";
import { join } from "node:path";
import type { HaHealthCheck, HaHealthResponse } from "@homebot/shared";
import { getWorkspaceRoot } from "../openclaw/state-root.js";
import { isControllableDomain } from "./area-merge.js";
import { fetchHaAreas } from "./areas.js";
import { getHaConfigMeta, haFetch } from "./client.js";
import { haCallWsAll } from "./websocket.js";

function areasConfigPath(): string {
  return join(getWorkspaceRoot(), "homeassistant-areas.json");
}

function check(id: string, label: string, ok: boolean, detail?: string): HaHealthCheck {
  return { id, label, ok, detail };
}

export async function fetchHaHealth(): Promise<HaHealthResponse> {
  const meta = getHaConfigMeta();
  const configPath = areasConfigPath();
  const checks: HaHealthCheck[] = [];
  const timestamp = new Date().toISOString();

  const base: HaHealthResponse = {
    ok: false,
    configured: meta.tokenConfigured,
    url: meta.url,
    token_source: meta.tokenSource,
    token_path: meta.tokenPath,
    rest_reachable: false,
    auth_ok: false,
    websocket_ok: false,
    states_count: 0,
    controllable_count: 0,
    registry_areas: 0,
    areas_with_devices: 0,
    devices_in_areas: 0,
    areas_config_file: existsSync(configPath),
    areas_config_path: configPath,
    checks,
    timestamp,
  };

  checks.push(
    check(
      "token",
      "Token",
      meta.tokenConfigured,
      meta.tokenConfigured
        ? meta.tokenSource === "env"
          ? "HOMEBOT_HA_TOKEN"
          : meta.tokenPath
        : "~/.openclaw/secrets/ha-token missing",
    ),
  );

  if (!meta.tokenConfigured) {
    checks.push(check("rest", "REST", false, "No token"));
    checks.push(check("auth", "Auth", false, "No token"));
    checks.push(check("websocket", "WebSocket", false, "No token"));
    checks.push(check("devices", "Devices", false, "No token"));
    base.checks = checks;
    base.error = "Home Assistant token not configured";
    return base;
  }

  let restStatus: number | undefined;
  try {
    const ping = await haFetch("/api/");
    restStatus = ping.status;
    base.rest_reachable = ping.ok;
    base.rest_status = restStatus;
    checks.push(
      check(
        "rest",
        "REST",
        ping.ok,
        ping.ok ? meta.url : `HTTP ${ping.status} at ${meta.url}`,
      ),
    );
  } catch (err) {
    checks.push(check("rest", "REST", false, `${meta.url} — ${String(err)}`));
    base.error = String(err);
    base.checks = checks;
    return base;
  }

  try {
    const statesRes = await haFetch("/api/states");
    base.auth_ok = statesRes.status !== 401 && statesRes.status !== 403;
    if (!statesRes.ok) {
      checks.push(
        check(
          "auth",
          "Auth",
          false,
          statesRes.status === 401 || statesRes.status === 403
            ? "Invalid or expired token"
            : `States HTTP ${statesRes.status}`,
        ),
      );
      base.error = `HA states failed (${statesRes.status})`;
      base.checks = checks;
      return base;
    }

    const states = (await statesRes.json()) as Array<{ entity_id: string; state: string }>;
    base.states_count = states.length;
    base.controllable_count = states.filter(
      (s) => isControllableDomain(s.entity_id) && s.state !== "unavailable",
    ).length;
    checks.push(check("auth", "Auth", true, "Token accepted"));
  } catch (err) {
    checks.push(check("auth", "Auth", false, String(err)));
    base.error = String(err);
    base.checks = checks;
    return base;
  }

  try {
    const [areaList] = await haCallWsAll(["config/area_registry/list"]);
    base.registry_areas = Array.isArray(areaList) ? areaList.length : 0;
    base.websocket_ok = true;
    checks.push(check("websocket", "WebSocket", true, `${base.registry_areas} areas in registry`));
  } catch (err) {
    checks.push(check("websocket", "WebSocket", false, String(err)));
  }

  const areasData = await fetchHaAreas();
  base.areas_with_devices = areasData.areas.length;
  base.devices_in_areas = areasData.areas.reduce((n, a) => n + a.entities.length, 0);
  const devicesOk = base.devices_in_areas > 0;
  checks.push(
    check(
      "devices",
      "Devices",
      devicesOk,
      devicesOk
        ? `${base.devices_in_areas} in ${base.areas_with_devices} areas`
        : base.controllable_count > 0
          ? `${base.controllable_count} controllable entities but none mapped to areas`
          : "No controllable lights/switches found",
    ),
  );

  if (base.areas_config_file) {
    checks.push(check("config", "Config file", true, configPath));
  }

  if (!areasData.reachable && areasData.error) {
    base.error = areasData.error;
  } else if (!devicesOk && base.controllable_count === 0) {
    base.error = "No controllable entities in Home Assistant";
  } else if (!devicesOk) {
    base.error = "Assign lights/switches to areas in Home Assistant";
  }

  base.ok =
    meta.tokenConfigured &&
    base.rest_reachable &&
    base.auth_ok &&
    base.websocket_ok &&
    devicesOk;

  base.checks = checks;
  return base;
}
