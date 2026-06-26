import type { PlanCreatePayload, PlanResponse, PlanUpdatePayload } from "@homebot/shared";

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

export async function createPlanItem(payload: PlanCreatePayload): Promise<PlanResponse> {
  const res = await fetch("/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to add task");
  }
  return res.json() as Promise<PlanResponse>;
}

export async function deletePlanItem(index: number): Promise<PlanResponse> {
  const res = await fetch(`/api/plan/${index}`, { method: "DELETE" });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to delete task");
  }
  return res.json() as Promise<PlanResponse>;
}

export async function deferPlanItem(index: number): Promise<PlanResponse> {
  const res = await fetch("/api/plan/defer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ index }),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error?: string };
    throw new Error(err.error ?? "Failed to defer task");
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

export async function snoozeNotification(id: string, minutes = 5): Promise<void> {
  await fetch("/api/notifications/snooze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, minutes }),
  });
}

export async function exitApp(): Promise<void> {
  await fetch("/api/exit", { method: "POST" });
  if (document.fullscreenElement) {
    await document.exitFullscreen().catch(() => {});
  }
  window.close();
}
