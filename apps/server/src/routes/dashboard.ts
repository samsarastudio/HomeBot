import type { DashboardData } from "@homebot/shared";
import { buildStatusSnapshot } from "../openclaw/snapshot.js";
import { readSystemMetrics, readSessionCounts } from "../openclaw/system.js";
import { getPlan } from "../plan-file.js";
import { parseTodayEvents } from "../events/parser.js";
import { getPendingNotifications } from "../events/scheduler.js";

export async function buildDashboardData(): Promise<DashboardData> {
  const [status, plan, events] = await Promise.all([
    buildStatusSnapshot(),
    getPlan(),
    parseTodayEvents(),
  ]);
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
    events,
    pending_notifications: getPendingNotifications(),
    openclaw: status,
    timestamp: new Date().toISOString(),
  };
}
