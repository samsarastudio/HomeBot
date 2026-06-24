import type { PlanResponse } from "@homebot/shared";

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

export async function updatePlanItemTime(index: number, time: string): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index, time }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to update time");
  }
  return res.json() as Promise<PlanResponse>;
}

export async function dismissNotification(id: string): Promise<void> {
  await fetch("/api/notifications/dismiss", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id }),
  });
}

export async function exitApp(): Promise<void> {
  await fetch("/api/exit", { method: "POST" });
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
  window.close();
}
