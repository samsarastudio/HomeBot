import { describe, expect, it } from "vitest";
import {
  areaActionFromEntities,
  areaToggleTarget,
  mergeRegistryAreas,
  toHaEntity,
} from "./area-merge.js";

describe("mergeRegistryAreas", () => {
  const areas = [
    { area_id: "dining", name: "Dining" },
    { area_id: "kitchen", name: "Kitchen" },
  ];

  const devices = [{ id: "dev1", area_id: "dining" }];

  const entities = [
    { entity_id: "light.dining_main", area_id: null, device_id: "dev1" },
    { entity_id: "switch.dining_lamp", area_id: "dining", device_id: null },
    { entity_id: "light.kitchen", area_id: "kitchen", device_id: null },
    { entity_id: "sensor.temp", area_id: "dining", device_id: null },
  ];

  const states = new Map([
    ["light.dining_main", { entity_id: "light.dining_main", state: "off", attributes: { friendly_name: "Dining Main" } }],
    ["switch.dining_lamp", { entity_id: "switch.dining_lamp", state: "on", attributes: { friendly_name: "Dining Lamp" } }],
    ["light.kitchen", { entity_id: "light.kitchen", state: "off", attributes: { friendly_name: "Kitchen Light" } }],
    ["sensor.temp", { entity_id: "sensor.temp", state: "21", attributes: { friendly_name: "Temp" } }],
  ]);

  it("groups controllable devices under areas via entity and device registry", () => {
    const result = mergeRegistryAreas(areas, entities, devices, states);
    const dining = result.find((a) => a.id === "dining");
    const kitchen = result.find((a) => a.id === "kitchen");

    expect(dining?.entities).toHaveLength(2);
    expect(dining?.entities.map((e) => e.entity_id).sort()).toEqual(
      ["light.dining_main", "switch.dining_lamp"].sort(),
    );
    expect(kitchen?.entities).toHaveLength(1);
    expect(kitchen?.entities[0]!.entity_id).toBe("light.kitchen");
  });

  it("skips empty areas and non-controllable entities", () => {
    const result = mergeRegistryAreas(areas, entities, devices, states);
    expect(result.some((a) => a.entities.length === 0)).toBe(false);
    expect(result.flatMap((a) => a.entities).some((e) => e.entity_id === "sensor.temp")).toBe(false);
  });
});

describe("areaActionFromEntities", () => {
  it("derives on, off, and mixed from device states", () => {
    const allOff = [
      toHaEntity({ entity_id: "light.a", state: "off" }),
      toHaEntity({ entity_id: "light.b", state: "off" }),
    ];
    const allOn = [
      toHaEntity({ entity_id: "light.a", state: "on" }),
      toHaEntity({ entity_id: "light.b", state: "on" }),
    ];
    const mixed = [
      toHaEntity({ entity_id: "light.a", state: "on" }),
      toHaEntity({ entity_id: "light.b", state: "off" }),
    ];

    expect(areaActionFromEntities(allOff)).toBe("off");
    expect(areaActionFromEntities(allOn)).toBe("on");
    expect(areaActionFromEntities(mixed)).toBe("mixed");
    expect(areaToggleTarget(mixed)).toBe("on");
    expect(areaToggleTarget(allOn)).toBe("off");
  });
});
