import type { DashboardData, PlanResponse } from "@homebot/shared";

export async function fetchDashboardData(): Promise<DashboardData> {
  const res = await fetch("/api/dashboard/data");
  if (!res.ok) throw new Error("Failed to load dashboard data");
  return res.json() as Promise<DashboardData>;
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
