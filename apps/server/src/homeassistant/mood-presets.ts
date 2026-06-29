import type { HaLightSceneData, HaMood, HaStartupSequence } from "@homebot/shared";

export const DEFAULT_MOODS: HaMood[] = [
  {
    id: "bar",
    name: "Bar",
    emoji: "🍸",
    description: "Dim amber pub glow",
    data: {
      brightness_pct: 38,
      rgb_color: [255, 120, 40],
      transition: 2,
    },
  },
  {
    id: "party",
    name: "Party",
    emoji: "🎉",
    description: "Random bold color per room — all lights in each area match",
    data: {
      brightness_pct: 100,
      transition: 1,
    },
  },
  {
    id: "candle",
    name: "Candle",
    emoji: "🕯️",
    description: "Soft flickering candlelight",
    data: {
      brightness_pct: 42,
      effect: "Candlelight",
      transition: 2,
    },
  },
  {
    id: "cozy",
    name: "Cozy",
    emoji: "🛋️",
    description: "Warm white evening relax",
    data: {
      brightness_pct: 48,
      color_temp_kelvin: 2700,
      effect: "Cozy",
      transition: 3,
    },
  },
  {
    id: "ocean",
    name: "Ocean",
    emoji: "🌊",
    description: "Cool calm blue rhythm",
    data: {
      brightness_pct: 55,
      effect: "Ocean",
      transition: 2,
    },
  },
];

export const WARM_STARTUP: HaStartupSequence = {
  id: "warm-welcome",
  name: "Warm Welcome",
  emoji: "🌅",
  description: "Staggered warm sunrise through each room",
  area_order: ["entry", "dining", "kitchen", "living", "office", "bedroom"],
  steps: [
    { brightness_pct: 8, color_temp_kelvin: 2200, transition: 0 },
    { brightness_pct: 28, color_temp_kelvin: 2500, transition: 2.5, delay_ms: 700 },
    { brightness_pct: 52, color_temp_kelvin: 2700, transition: 4, delay_ms: 1600 },
    { brightness_pct: 70, color_temp_kelvin: 2800, transition: 5, delay_ms: 2800 },
  ],
};

export function getMoodById(id: string): HaMood | undefined {
  return DEFAULT_MOODS.find((m) => m.id === id);
}

export function areaSortKey(name: string, order: string[]): number {
  const normalized = name.toLowerCase().replace(/\s+/g, "");
  const idx = order.findIndex((o) => normalized.includes(o) || o.includes(normalized));
  return idx >= 0 ? idx : 999;
}

export const PARTY_COLORS: [number, number, number][] = [
  [255, 0, 128],
  [0, 200, 255],
  [255, 220, 0],
  [140, 0, 255],
  [0, 255, 120],
  [255, 60, 60],
  [255, 140, 0],
  [80, 120, 255],
  [255, 105, 180],
  [0, 255, 200],
];

export function pickPartyColors(count: number): [number, number, number][] {
  const pool = [...PARTY_COLORS].sort(() => Math.random() - 0.5);
  const out: [number, number, number][] = [];
  for (let i = 0; i < count; i++) {
    out.push(pool[i % pool.length]!);
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { sleep as moodSleep };
