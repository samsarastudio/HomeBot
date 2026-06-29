import type { HaLightSceneData, HaMood, HaMoodsResponse, HaStartupSequence } from "@homebot/shared";
import { fetchHaAreas } from "./areas.js";
import { haFetch } from "./client.js";
import {
  DEFAULT_MOODS,
  WARM_STARTUP,
  areaSortKey,
  getMoodById,
  moodSleep,
  pickPartyColors,
} from "./mood-presets.js";

export interface LightTarget {
  entity_ids?: string[];
  area_id?: string;
  all_lights?: boolean;
}

export interface ManagedAreaLights {
  area_id: string;
  area_name: string;
  entity_ids: string[];
}

export async function getManagedLightsByArea(): Promise<ManagedAreaLights[]> {
  const data = await fetchHaAreas();
  return data.areas
    .map((area) => ({
      area_id: area.id,
      area_name: area.name,
      entity_ids: area.entities.filter((e) => e.domain === "light").map((e) => e.entity_id),
    }))
    .filter((a) => a.entity_ids.length > 0);
}

export async function getManagedLightIds(): Promise<string[]> {
  const byArea = await getManagedLightsByArea();
  return byArea.flatMap((a) => a.entity_ids);
}

async function resolveLightTarget(target: LightTarget): Promise<string[]> {
  if (target.entity_ids?.length) {
    return target.entity_ids.filter((id) => id.startsWith("light."));
  }
  if (target.area_id) {
    const byArea = await getManagedLightsByArea();
    return byArea.find((a) => a.area_id === target.area_id)?.entity_ids ?? [];
  }
  return getManagedLightIds();
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

async function applyPartyMode(target: LightTarget): Promise<{ entity_ids: string[] }> {
  const byArea = await getManagedLightsByArea();
  if (byArea.length === 0) throw new Error("No managed lights found");

  if (target.entity_ids?.length === 1) {
    const rgb = pickPartyColors(1)[0]!;
    return applyLightScene({ entity_ids: target.entity_ids }, {
      brightness_pct: 100,
      rgb_color: rgb,
      transition: 1,
    });
  }

  if (target.area_id) {
    const area = byArea.find((a) => a.area_id === target.area_id);
    if (!area?.entity_ids.length) throw new Error("No lights in this area");
    const rgb = pickPartyColors(1)[0]!;
    return applyLightScene({ entity_ids: area.entity_ids }, {
      brightness_pct: 100,
      rgb_color: rgb,
      transition: 1,
    });
  }

  const colors = pickPartyColors(byArea.length);
  const allIds: string[] = [];
  for (let i = 0; i < byArea.length; i++) {
    const area = byArea[i]!;
    const rgb = colors[i]!;
    await applyLightScene({ entity_ids: area.entity_ids }, {
      brightness_pct: 100,
      rgb_color: rgb,
      transition: 1,
    });
    allIds.push(...area.entity_ids);
  }
  return { entity_ids: allIds };
}

export async function applyMood(
  moodId: string,
  target: LightTarget = { all_lights: true },
): Promise<{ mood_id: string; entity_ids: string[] }> {
  if (moodId === "party") {
    const result = await applyPartyMode(target);
    return { mood_id: moodId, entity_ids: result.entity_ids };
  }

  const mood = getMoodById(moodId);
  if (!mood) throw new Error(`Unknown mood: ${moodId}`);
  const result = await applyLightScene(target, mood.data);
  return { mood_id: moodId, entity_ids: result.entity_ids };
}

export async function turnOffLights(target: LightTarget): Promise<{ entity_ids: string[] }> {
  const entity_ids = await resolveLightTarget(target);
  if (entity_ids.length === 0) {
    throw new Error("No lights found for this target");
  }

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
  return { entity_ids };
}

export async function turnOffAllManagedLights(): Promise<{ entity_ids: string[] }> {
  const entity_ids = await getManagedLightIds();
  if (entity_ids.length === 0) throw new Error("No managed lights found in areas");
  return turnOffLights({ entity_ids });
}

export async function runWarmStartup(sequence: HaStartupSequence = WARM_STARTUP): Promise<void> {
  const byArea = await getManagedLightsByArea();
  if (byArea.length === 0) {
    throw new Error("No managed lights available for startup sequence");
  }

  const areasWithLights = [...byArea].sort(
    (a, b) =>
      areaSortKey(a.area_name, sequence.area_order) -
      areaSortKey(b.area_name, sequence.area_order),
  );

  const allManagedIds = areasWithLights.flatMap((a) => a.entity_ids);
  await turnOffLights({ entity_ids: allManagedIds });
  await moodSleep(400);

  const [firstStep, ...rampSteps] = sequence.steps;
  if (!firstStep) return;

  for (let i = 0; i < areasWithLights.length; i++) {
    const { entity_ids: lights } = areasWithLights[i]!;
    await moodSleep(i * 500);
    await applyLightScene({ entity_ids: lights }, {
      brightness_pct: firstStep.brightness_pct,
      color_temp_kelvin: firstStep.color_temp_kelvin,
      transition: firstStep.transition ?? 0,
    });
  }

  for (const step of rampSteps) {
    if (step.delay_ms) await moodSleep(step.delay_ms);
    await applyLightScene({ entity_ids: allManagedIds }, {
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
