import type { HaArea, HaEntity } from "@homebot/shared";

export const CONTROLLABLE_DOMAINS = new Set([
  "light",
  "switch",
  "fan",
  "input_boolean",
  "cover",
  "outlet",
  "group",
]);

export interface HaStateLike {
  entity_id: string;
  state: string;
  attributes?: { friendly_name?: string };
}

export interface AreaRegistryEntry {
  area_id: string;
  name: string;
}

export interface EntityRegistryEntry {
  entity_id: string;
  area_id: string | null;
  device_id: string | null;
}

export interface DeviceRegistryEntry {
  id: string;
  area_id: string | null;
}

export function isControllableDomain(entityId: string): boolean {
  const domain = entityId.split(".")[0] ?? "";
  return CONTROLLABLE_DOMAINS.has(domain);
}

export function isOnState(state: string): boolean {
  const s = state.toLowerCase();
  return s === "on" || s === "open" || s === "true";
}

export function toHaEntity(state: HaStateLike): HaEntity {
  const domain = state.entity_id.split(".")[0] ?? "";
  const name = state.attributes?.friendly_name ?? state.entity_id;
  return {
    entity_id: state.entity_id,
    name,
    domain,
    state: state.state,
    on: isOnState(state.state),
  };
}

export function buildEntityAreaMap(
  entList: EntityRegistryEntry[],
  deviceList: DeviceRegistryEntry[],
): Map<string, string> {
  const deviceAreas = new Map<string, string>();
  for (const d of deviceList) {
    if (d.area_id) deviceAreas.set(d.id, d.area_id);
  }

  const entityAreas = new Map<string, string>();
  for (const ent of entList) {
    if (ent.area_id) {
      entityAreas.set(ent.entity_id, ent.area_id);
      continue;
    }
    if (ent.device_id) {
      const deviceArea = deviceAreas.get(ent.device_id);
      if (deviceArea) entityAreas.set(ent.entity_id, deviceArea);
    }
  }
  return entityAreas;
}

export function mergeRegistryAreas(
  areaList: AreaRegistryEntry[],
  entList: EntityRegistryEntry[],
  deviceList: DeviceRegistryEntry[],
  states: Map<string, HaStateLike>,
): HaArea[] {
  const areaNames = new Map<string, string>();
  for (const a of areaList) areaNames.set(a.area_id, a.name);

  const entityAreas = buildEntityAreaMap(entList, deviceList);
  const byArea = new Map<string, HaEntity[]>();
  for (const a of areaList) byArea.set(a.area_id, []);

  const seen = new Set<string>();
  const other: HaEntity[] = [];

  const assign = (areaId: string | null | undefined, entity: HaEntity): void => {
    if (seen.has(entity.entity_id)) return;
    seen.add(entity.entity_id);
    if (areaId && areaNames.has(areaId)) {
      const list = byArea.get(areaId) ?? [];
      list.push(entity);
      byArea.set(areaId, list);
      return;
    }
    other.push(entity);
  };

  for (const ent of entList) {
    if (!isControllableDomain(ent.entity_id)) continue;
    const st = states.get(ent.entity_id);
    if (!st || st.state === "unavailable") continue;
    assign(entityAreas.get(ent.entity_id) ?? ent.area_id, toHaEntity(st));
  }

  for (const st of states.values()) {
    if (seen.has(st.entity_id)) continue;
    if (!isControllableDomain(st.entity_id) || st.state === "unavailable") continue;
    assign(entityAreas.get(st.entity_id), toHaEntity(st));
  }

  const areas: HaArea[] = [];
  for (const [areaId, entities] of byArea) {
    if (entities.length === 0) continue;
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

export function areaActionFromEntities(entities: HaEntity[]): "on" | "off" | "mixed" {
  if (entities.length === 0) return "off";
  const onCount = entities.filter((e) => e.on).length;
  if (onCount === 0) return "off";
  if (onCount === entities.length) return "on";
  return "mixed";
}

export function areaToggleTarget(entities: HaEntity[]): "on" | "off" {
  const action = areaActionFromEntities(entities);
  return action === "on" ? "off" : "on";
}
