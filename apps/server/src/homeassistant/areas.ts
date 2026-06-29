import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HaArea, HaAreasResponse, HaEntity } from "@homebot/shared";
import { getWorkspaceRoot } from "../openclaw/state-root.js";
import { getHaConfig, haFetch } from "./client.js";
import {
  areaActionFromEntities,
  areaToggleTarget,
  isControllableDomain,
  mergeRegistryAreas,
  toHaEntity,
  type AreaRegistryEntry,
  type DeviceRegistryEntry,
  type EntityRegistryEntry,
  type HaStateLike,
} from "./area-merge.js";
import { haCallWsAll } from "./websocket.js";

interface AreasConfigFile {
  areas?: Array<{ id?: string; name: string; entities?: string[] }>;
}

function areasConfigPath(): string {
  return join(getWorkspaceRoot(), "homeassistant-areas.json");
}

function loadAreasConfig(): AreasConfigFile | null {
  const path = areasConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as AreasConfigFile;
  } catch {
    return null;
  }
}

async function fetchStates(): Promise<Map<string, HaStateLike>> {
  const res = await haFetch("/api/states");
  if (!res.ok) throw new Error(`HA states failed: ${res.status}`);
  const states = (await res.json()) as HaStateLike[];
  const map = new Map<string, HaStateLike>();
  for (const s of states) map.set(s.entity_id, s);
  return map;
}

function buildFromConfig(cfg: AreasConfigFile, states: Map<string, HaStateLike>): HaArea[] {
  const areas: HaArea[] = [];
  for (const area of cfg.areas ?? []) {
    const entities: HaEntity[] = [];
    for (const eid of area.entities ?? []) {
      const st = states.get(eid);
      if (st && isControllableDomain(eid)) entities.push(toHaEntity(st));
    }
    if (entities.length === 0) continue;
    areas.push({
      id: area.id ?? area.name.toLowerCase().replace(/\s+/g, "-"),
      name: area.name,
      entities,
    });
  }
  return areas;
}

function buildFromAllStates(states: Map<string, HaStateLike>): HaArea[] {
  const entities: HaEntity[] = [];
  for (const st of states.values()) {
    if (!isControllableDomain(st.entity_id) || st.state === "unavailable") continue;
    entities.push(toHaEntity(st));
  }
  entities.sort((a, b) => a.name.localeCompare(b.name));
  if (entities.length === 0) return [];
  return [{ id: "all", name: "Devices", entities }];
}

async function buildFromHaRegistry(states: Map<string, HaStateLike>): Promise<HaArea[]> {
  try {
    const [areaList, entList, deviceList] = await haCallWsAll([
      "config/area_registry/list",
      "config/entity_registry/list",
      "config/device_registry/list",
    ]);
    return mergeRegistryAreas(
      areaList as AreaRegistryEntry[],
      entList as EntityRegistryEntry[],
      deviceList as DeviceRegistryEntry[],
      states,
    );
  } catch {
    return buildFromAllStates(states);
  }
}

function mergeConfigWithRegistry(configAreas: HaArea[], registryAreas: HaArea[]): HaArea[] {
  if (configAreas.length === 0) return registryAreas;
  const byId = new Map(registryAreas.map((a) => [a.id, { ...a, entities: [...a.entities] }]));
  const byName = new Map(registryAreas.map((a) => [a.name.toLowerCase(), a.id]));

  for (const cfg of configAreas) {
    const key = cfg.id ?? byName.get(cfg.name.toLowerCase()) ?? cfg.name.toLowerCase().replace(/\s+/g, "-");
    const existing = byId.get(key);
    if (existing) {
      const seen = new Set(existing.entities.map((e) => e.entity_id));
      for (const ent of cfg.entities) {
        if (!seen.has(ent.entity_id)) existing.entities.push(ent);
      }
      existing.entities.sort((a, b) => a.name.localeCompare(b.name));
      continue;
    }
    byId.set(key, cfg);
  }

  return [...byId.values()]
    .filter((a) => a.entities.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function resolveAreas(states: Map<string, HaStateLike>): Promise<HaArea[]> {
  const registryAreas = await buildFromHaRegistry(states);
  const fileCfg = loadAreasConfig();
  if (!fileCfg?.areas?.length) return registryAreas;

  const configAreas = buildFromConfig(fileCfg, states);
  if (configAreas.length === 0) return registryAreas;
  return mergeConfigWithRegistry(configAreas, registryAreas);
}

const AREA_ON_SERVICES = [
  { domain: "light", service: "turn_on" },
  { domain: "switch", service: "turn_on" },
  { domain: "fan", service: "turn_on" },
  { domain: "input_boolean", service: "turn_on" },
  { domain: "cover", service: "open_cover" },
] as const;

const AREA_OFF_SERVICES = [
  { domain: "light", service: "turn_off" },
  { domain: "switch", service: "turn_off" },
  { domain: "fan", service: "turn_off" },
  { domain: "input_boolean", service: "turn_off" },
  { domain: "cover", service: "close_cover" },
] as const;

export async function callHaAreaTarget(areaId: string, action: "on" | "off"): Promise<void> {
  const services = action === "on" ? AREA_ON_SERVICES : AREA_OFF_SERVICES;
  const body = JSON.stringify({ target: { area_id: areaId } });

  const results = await Promise.allSettled(
    services.map(({ domain, service }) =>
      haFetch(`/api/services/${domain}/${service}`, { method: "POST", body }),
    ),
  );

  const ok = results.some((r) => r.status === "fulfilled" && r.value.ok);
  if (ok) return;

  const firstErr = results.find((r) => r.status === "rejected" || (r.status === "fulfilled" && !r.value.ok));
  if (firstErr?.status === "fulfilled") {
    throw new Error((await firstErr.value.text()) || "HA area service failed");
  }
  throw new Error(String((firstErr as PromiseRejectedResult | undefined)?.reason ?? "HA area service failed"));
}

async function callHaEntities(entities: HaEntity[], action: "on" | "off"): Promise<void> {
  const results = await Promise.allSettled(
    entities.map((e) => callHaService(e.entity_id, action)),
  );
  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length === results.length) {
    throw new Error(String((failed[0] as PromiseRejectedResult).reason));
  }
  if (failed.length > 0) {
    throw new Error(`${failed.length} of ${results.length} devices failed`);
  }
}

export async function fetchHaAreas(): Promise<HaAreasResponse> {
  const cfg = getHaConfig();
  if (!cfg) {
    return {
      configured: false,
      reachable: false,
      areas: [],
      error: "Set HOMEBOT_HA_TOKEN or ~/.openclaw/secrets/ha-token",
    };
  }

  try {
    const ping = await haFetch("/api/");
    if (!ping.ok) {
      return { configured: true, reachable: false, areas: [], error: `HA unreachable (${ping.status})` };
    }

    const states = await fetchStates();
    const areas = await resolveAreas(states);

    return { configured: true, reachable: true, areas };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      areas: [],
      error: String(err),
    };
  }
}

export async function callHaService(
  entityId: string,
  action: "on" | "off" | "toggle",
): Promise<void> {
  const domain = entityId.split(".")[0] ?? "homeassistant";
  let serviceDomain = domain;
  let service: string;

  if (action === "toggle") {
    if (domain === "cover") {
      serviceDomain = "cover";
      service = "toggle_cover";
    } else if (isControllableDomain(entityId)) {
      service = "toggle";
    } else {
      serviceDomain = "homeassistant";
      service = "toggle";
    }
  } else if (action === "on") {
    service = domain === "cover" ? "open_cover" : "turn_on";
  } else {
    service = domain === "cover" ? "close_cover" : "turn_off";
  }

  const res = await haFetch(`/api/services/${serviceDomain}/${service}`, {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HA service failed (${res.status})`);
  }
}

export async function toggleHaArea(
  areaId: string,
  action?: "on" | "off" | "toggle",
): Promise<{ action: "on" | "off"; entity_ids: string[] }> {
  const data = await fetchHaAreas();
  const area = data.areas.find((a) => a.id === areaId);
  if (!area) throw new Error(`Area not found: ${areaId}`);

  let target: "on" | "off";
  if (action === "on" || action === "off") {
    target = action;
  } else if (area.entities.length > 0) {
    target = areaToggleTarget(area.entities);
  } else {
    target = "on";
  }

  if (area.entities.length > 0) {
    try {
      await callHaEntities(area.entities, target);
    } catch {
      await callHaAreaTarget(areaId, target);
    }
  } else {
    await callHaAreaTarget(areaId, target);
  }

  const after = await fetchHaAreas();
  const updated = after.areas.find((a) => a.id === areaId);
  const entity_ids = updated?.entities.map((e) => e.entity_id) ?? [];
  if (updated && updated.entities.length > 0) {
    const state = areaActionFromEntities(updated.entities);
    return { action: state === "off" ? "off" : "on", entity_ids };
  }
  return { action: target, entity_ids };
}
