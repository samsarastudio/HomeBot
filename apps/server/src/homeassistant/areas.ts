import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { HaArea, HaAreasResponse, HaEntity } from "@homebot/shared";
import { getWorkspaceRoot } from "../openclaw/state-root.js";
import { getHaConfig, haFetch } from "./client.js";
import { haCallWsAll } from "./websocket.js";

const CONTROLLABLE = new Set([
  "light",
  "switch",
  "fan",
  "input_boolean",
  "cover",
  "outlet",
  "group",
]);

interface HaState {
  entity_id: string;
  state: string;
  attributes?: { friendly_name?: string };
}

interface AreaRegistryEntry {
  area_id: string;
  name: string;
}

interface EntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
}

interface DeviceRegistryEntry {
  id: string;
  area_id: string | null;
}

interface AreasConfigFile {
  areas?: Array<{ id?: string; name: string; entities?: string[] }>;
}

function isOn(state: string): boolean {
  const s = state.toLowerCase();
  return s === "on" || s === "open" || s === "true";
}

function toEntity(state: HaState): HaEntity {
  const domain = state.entity_id.split(".")[0] ?? "";
  const name = state.attributes?.friendly_name ?? state.entity_id;
  return {
    entity_id: state.entity_id,
    name,
    domain,
    state: state.state,
    on: isOn(state.state),
  };
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

async function fetchStates(): Promise<Map<string, HaState>> {
  const res = await haFetch("/api/states");
  if (!res.ok) throw new Error(`HA states failed: ${res.status}`);
  const states = (await res.json()) as HaState[];
  const map = new Map<string, HaState>();
  for (const s of states) map.set(s.entity_id, s);
  return map;
}

function buildFromConfig(cfg: AreasConfigFile, states: Map<string, HaState>): HaArea[] {
  const areas: HaArea[] = [];
  for (const area of cfg.areas ?? []) {
    const entities: HaEntity[] = [];
    for (const eid of area.entities ?? []) {
      const st = states.get(eid);
      if (st) entities.push(toEntity(st));
    }
    areas.push({
      id: area.id ?? area.name.toLowerCase().replace(/\s+/g, "-"),
      name: area.name,
      entities,
    });
  }
  return areas;
}

function buildFromAllStates(states: Map<string, HaState>): HaArea[] {
  const entities: HaEntity[] = [];
  for (const st of states.values()) {
    const domain = st.entity_id.split(".")[0] ?? "";
    if (!CONTROLLABLE.has(domain) || st.state === "unavailable") continue;
    entities.push(toEntity(st));
  }
  entities.sort((a, b) => a.name.localeCompare(b.name));
  if (entities.length === 0) return [];
  return [{ id: "all", name: "Devices", entities }];
}

function resolveEntityAreaId(
  ent: EntityRegistryEntry,
  deviceAreas: Map<string, string>,
  areaNames: Map<string, string>,
): string | null {
  if (ent.area_id && areaNames.has(ent.area_id)) return ent.area_id;
  if (ent.device_id) {
    const deviceArea = deviceAreas.get(ent.device_id);
    if (deviceArea && areaNames.has(deviceArea)) return deviceArea;
  }
  return null;
}

function mergeRegistryAreas(
  areaList: AreaRegistryEntry[],
  entList: EntityRegistryEntry[],
  deviceList: DeviceRegistryEntry[],
  states: Map<string, HaState>,
): HaArea[] {
  const areaNames = new Map<string, string>();
  for (const a of areaList) areaNames.set(a.area_id, a.name);

  const deviceAreas = new Map<string, string>();
  for (const d of deviceList) {
    if (d.area_id) deviceAreas.set(d.id, d.area_id);
  }

  const byArea = new Map<string, HaEntity[]>();
  for (const a of areaList) byArea.set(a.area_id, []);

  const other: HaEntity[] = [];

  for (const ent of entList) {
    const domain = ent.entity_id.split(".")[0] ?? "";
    if (!CONTROLLABLE.has(domain)) continue;
    const st = states.get(ent.entity_id);
    if (!st || st.state === "unavailable") continue;
    const entity = toEntity(st);
    const areaId = resolveEntityAreaId(ent, deviceAreas, areaNames);
    if (areaId) {
      const list = byArea.get(areaId) ?? [];
      list.push(entity);
      byArea.set(areaId, list);
    } else {
      other.push(entity);
    }
  }

  const areas: HaArea[] = [];
  for (const [areaId, entities] of byArea) {
    entities.sort((a, b) => a.name.localeCompare(b.name));
    areas.push({ id: areaId, name: areaNames.get(areaId) ?? areaId, entities });
  }
  areas.sort((a, b) => a.name.localeCompare(b.name));

  if (other.length > 0) {
    other.sort((a, b) => a.name.localeCompare(b.name));
    areas.push({ id: "other", name: "Other", entities: other });
  }

  return areas;
}

async function buildFromHaRegistry(states: Map<string, HaState>): Promise<HaArea[]> {
  try {
    const [areaList, entList, deviceList] = await haCallWsAll([
      "config/area_registry/list",
      "config/entity_registry/list",
      "config/device_registry/list",
    ]);
    const areas = mergeRegistryAreas(
      areaList as AreaRegistryEntry[],
      entList as EntityRegistryEntry[],
      deviceList as DeviceRegistryEntry[],
      states,
    );
    if (areas.length > 0) return areas;
  } catch {
    /* fall through */
  }
  return buildFromAllStates(states);
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

async function resolveAreas(states: Map<string, HaState>): Promise<HaArea[]> {
  const fileCfg = loadAreasConfig();
  if (fileCfg?.areas?.length) {
    const fromConfig = buildFromConfig(fileCfg, states);
    const hasEntities = fromConfig.some((a) => a.entities.length > 0);
    if (hasEntities) return fromConfig.filter((a) => a.entities.length > 0);
  }
  return buildFromHaRegistry(states);
}

function areaActionFromEntities(entities: HaEntity[]): "on" | "off" {
  if (entities.length === 0) return "off";
  return entities.every((e) => e.on) ? "on" : "off";
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
    serviceDomain = "homeassistant";
    service = "toggle";
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
    target = areaActionFromEntities(area.entities) === "on" ? "off" : "on";
  } else {
    target = "on";
  }

  await callHaAreaTarget(areaId, target);

  const after = await fetchHaAreas();
  const updated = after.areas.find((a) => a.id === areaId);
  const entity_ids = updated?.entities.map((e) => e.entity_id) ?? [];
  if (updated && updated.entities.length > 0) {
    return { action: areaActionFromEntities(updated.entities), entity_ids };
  }
  return { action: target, entity_ids };
}
