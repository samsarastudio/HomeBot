import type { PlanResponse, PlanUpdatePayload } from "@homebot/shared";

async function putPlan(body: PlanUpdatePayload): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to update plan");
  }
  return res.json() as Promise<PlanResponse>;
}

export async function togglePlanItem(index: number, done: boolean): Promise<PlanResponse> {
  return putPlan({ index, done });
}

export async function updatePlanItem(payload: PlanUpdatePayload): Promise<PlanResponse> {
  return putPlan(payload);
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
