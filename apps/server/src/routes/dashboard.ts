import type { DashboardData } from "@homebot/shared";
import { buildStatusSnapshot } from "../openclaw/snapshot.js";
import { readSystemMetrics, readSessionCounts } from "../openclaw/system.js";
import { getPlan } from "../plan-file.js";

export async function buildDashboardData(): Promise<DashboardData> {
  const [status, plan] = await Promise.all([buildStatusSnapshot(), getPlan()]);
  const sessions = readSessionCounts();
  const system = readSystemMetrics();

  return {
    todolist: {
      completed: plan.doneCount,
      pending: plan.pending.length,
      plan,
    },
    sessions,
    system,
    cron_jobs: status.cron.jobs,
    gateway: {
      online: status.gateway.reachable,
      port: status.gateway.port,
    },
    tasks: status.tasks,
    openclaw: status,
    timestamp: new Date().toISOString(),
  };
}
