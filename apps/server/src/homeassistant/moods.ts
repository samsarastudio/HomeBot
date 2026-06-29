import type { HaLightSceneData, HaMood, HaMoodsResponse, HaStartupSequence } from "@homebot/shared";
import { fetchHaAreas } from "./areas.js";
import { haFetch } from "./client.js";
import {
  DEFAULT_MOODS,
  WARM_STARTUP,
  areaSortKey,
  getMoodById,
  moodSleep,
} from "./mood-presets.js";

export interface LightTarget {
  entity_ids?: string[];
  area_id?: string;
  all_lights?: boolean;
}

async function collectLightEntityIds(): Promise<string[]> {
  const data = await fetchHaAreas();
  const ids = new Set<string>();
  for (const area of data.areas) {
    for (const ent of area.entities) {
      if (ent.domain === "light") ids.add(ent.entity_id);
    }
  }
  return [...ids];
}

async function resolveLightTarget(target: LightTarget): Promise<string[]> {
  if (target.entity_ids?.length) {
    return target.entity_ids.filter((id) => id.startsWith("light."));
  }
  if (target.area_id) {
    const data = await fetchHaAreas();
    const area = data.areas.find((a) => a.id === target.area_id);
    return area?.entities.filter((e) => e.domain === "light").map((e) => e.entity_id) ?? [];
  }
  if (target.all_lights) return collectLightEntityIds();
  return collectLightEntityIds();
}

export async function applyLightScene(
  target: LightTarget,
  data: HaLightSceneData,
): Promise<{ entity_ids: string[] }> {
  const entity_ids = await resolveLightTarget(target);
  if (entity_ids.length === 0) {
    throw new Error("No lights found for this target");
  }

  const payload: Record<string, unknown> = { ...data };
  if (entity_ids.length === 1) {
    payload.entity_id = entity_ids[0];
  } else {
    payload.entity_id = entity_ids;
  }

  const res = await haFetch("/api/services/light/turn_on", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `Light scene failed (${res.status})`);
  }
  return { entity_ids };
}

export async function applyMood(
  moodId: string,
  target: LightTarget = { all_lights: true },
): Promise<{ mood_id: string; entity_ids: string[] }> {
  const mood = getMoodById(moodId);
  if (!mood) throw new Error(`Unknown mood: ${moodId}`);
  const result = await applyLightScene(target, mood.data);
  return { mood_id: moodId, entity_ids: result.entity_ids };
}

export async function turnOffLights(target: LightTarget = { all_lights: true }): Promise<void> {
  const entity_ids = await resolveLightTarget(target);
  if (entity_ids.length === 0) return;

  const payload =
    entity_ids.length === 1
      ? { entity_id: entity_ids[0], transition: 1 }
      : { entity_id: entity_ids, transition: 1 };

  const res = await haFetch("/api/services/light/turn_off", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error((await res.text()) || `Light off failed (${res.status})`);
  }
}

export async function runWarmStartup(sequence: HaStartupSequence = WARM_STARTUP): Promise<void> {
  const data = await fetchHaAreas();
  const areasWithLights = data.areas
    .map((area) => ({
      area,
      lights: area.entities.filter((e) => e.domain === "light").map((e) => e.entity_id),
    }))
    .filter((a) => a.lights.length > 0)
    .sort(
      (a, b) =>
        areaSortKey(a.area.name, sequence.area_order) -
        areaSortKey(b.area.name, sequence.area_order),
    );

  if (areasWithLights.length === 0) {
    throw new Error("No lights available for startup sequence");
  }

  await turnOffLights({ all_lights: true });
  await moodSleep(400);

  const [firstStep, ...rampSteps] = sequence.steps;
  if (!firstStep) return;

  for (let i = 0; i < areasWithLights.length; i++) {
    const { lights } = areasWithLights[i]!;
    await moodSleep(i * 500);
    await applyLightScene({ entity_ids: lights }, {
      brightness_pct: firstStep.brightness_pct,
      color_temp_kelvin: firstStep.color_temp_kelvin,
      transition: firstStep.transition ?? 0,
    });
  }

  for (const step of rampSteps) {
    if (step.delay_ms) await moodSleep(step.delay_ms);
    const allLights = areasWithLights.flatMap((a) => a.lights);
    await applyLightScene({ entity_ids: allLights }, {
      brightness_pct: step.brightness_pct,
      color_temp_kelvin: step.color_temp_kelvin,
      rgb_color: step.rgb_color,
      effect: step.effect,
      transition: step.transition ?? 3,
    });
  }
}

export function listMoods(): HaMoodsResponse {
  return {
    moods: DEFAULT_MOODS,
    startup: WARM_STARTUP,
  };
}

export { DEFAULT_MOODS, WARM_STARTUP };
