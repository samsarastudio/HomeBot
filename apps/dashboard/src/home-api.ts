import type { HaAreaToggleResponse, HaAreasResponse, HaHealthResponse, HaMoodsResponse } from "@homebot/shared";

export async function fetchHaMoods(): Promise<HaMoodsResponse> {
  const res = await fetch("/api/homeassistant/moods");
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to load moods");
  }
  return res.json() as Promise<HaMoodsResponse>;
}

export async function applyHaMood(
  moodId: string,
  target?: { entity_id?: string; area_id?: string },
): Promise<void> {
  const res = await fetch(`/api/homeassistant/moods/${encodeURIComponent(moodId)}/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(target ?? {}),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to apply mood");
  }
}

export async function runWarmStartup(): Promise<void> {
  const res = await fetch("/api/homeassistant/startup/warm", { method: "POST" });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to start warm sequence");
  }
}

export async function fetchHaHealth(): Promise<HaHealthResponse> {
  const res = await fetch("/api/homeassistant/health");
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to load Home Assistant health");
  }
  return res.json() as Promise<HaHealthResponse>;
}

export async function fetchHaAreas(): Promise<HaAreasResponse> {
  const res = await fetch("/api/homeassistant/areas");
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to load areas");
  }
  return res.json() as Promise<HaAreasResponse>;
}

export async function callHaService(
  entityId: string,
  action: "on" | "off" | "toggle",
): Promise<void> {
  const res = await fetch("/api/homeassistant/service", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entity_id: entityId, action }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Home Assistant command failed");
  }
}

export async function toggleHaArea(
  areaId: string,
  action: "on" | "off" | "toggle" = "toggle",
): Promise<HaAreaToggleResponse> {
  const path =
    action === "toggle"
      ? `/api/homeassistant/areas/${encodeURIComponent(areaId)}/toggle`
      : `/api/homeassistant/areas/${encodeURIComponent(areaId)}/${action}`;
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: action === "toggle" ? "{}" : JSON.stringify({ action }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Home Assistant area command failed");
  }
  return res.json() as Promise<HaAreaToggleResponse>;
}
