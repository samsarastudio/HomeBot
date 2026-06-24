import type { OpenClawStatus, PlanResponse } from "@homebot/shared";

export async function fetchStatus(): Promise<OpenClawStatus> {
  const res = await fetch("/api/openclaw/status");
  if (!res.ok) throw new Error("Failed to load status");
  return res.json() as Promise<OpenClawStatus>;
}

export async function fetchPlan(): Promise<PlanResponse> {
  const res = await fetch("/api/plan");
  if (!res.ok) throw new Error("Failed to load plan");
  return res.json() as Promise<PlanResponse>;
}

export async function togglePlanItem(index: number, done: boolean): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, done }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to update plan");
  }
  return res.json() as Promise<PlanResponse>;
}

export async function exitApp(): Promise<void> {
  await fetch("/api/exit", { method: "POST" });
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
  window.close();
}
