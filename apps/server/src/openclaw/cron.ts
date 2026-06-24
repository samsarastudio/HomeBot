import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CronJobSummary } from "@homebot/shared";
import { getStateRoot } from "./state-root.js";

interface CronJobsFile {
  jobs?: CronJobRecord[];
}

interface CronJobRecord {
  jobId?: string;
  id?: string;
  name?: string;
  enabled?: boolean;
  schedule?: {
    kind?: string;
    expr?: string;
    everyMs?: number;
    at?: string;
    tz?: string;
  };
}

interface CronRunLine {
  status?: string;
  startedAt?: string;
  finishedAt?: string;
  at?: string;
  ts?: string;
}

export async function readCronJobs(): Promise<CronJobSummary[]> {
  const jobsPath = join(getStateRoot(), "cron", "jobs.json");
  let jobs: CronJobRecord[] = [];

  try {
    const raw = await readFile(jobsPath, "utf8");
    const parsed = JSON.parse(raw) as CronJobsFile | CronJobRecord[];
    if (Array.isArray(parsed)) {
      jobs = parsed;
    } else {
      jobs = parsed.jobs ?? [];
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const summaries: CronJobSummary[] = [];

  for (const job of jobs) {
    const jobId = job.jobId ?? job.id ?? "unknown";
    const lastRun = await readLastCronRun(jobId);
    summaries.push({
      jobId,
      name: job.name ?? jobId,
      enabled: job.enabled !== false,
      schedule: formatSchedule(job.schedule),
      lastStatus: lastRun?.status,
      lastRunAt: lastRun?.finishedAt ?? lastRun?.startedAt ?? lastRun?.at ?? lastRun?.ts,
    });
  }

  return summaries;
}

function formatSchedule(schedule?: CronJobRecord["schedule"]): string | undefined {
  if (!schedule) return undefined;
  if (schedule.expr) return schedule.expr;
  if (schedule.everyMs) return `every ${Math.round(schedule.everyMs / 1000)}s`;
  if (schedule.at) return `at ${schedule.at}`;
  return schedule.kind;
}

async function readLastCronRun(jobId: string): Promise<CronRunLine | undefined> {
  const runPath = join(getStateRoot(), "cron", "runs", `${jobId}.jsonl`);
  try {
    const raw = await readFile(runPath, "utf8");
    const lines = raw.trim().split("\n").filter(Boolean);
    if (lines.length === 0) return undefined;
    return JSON.parse(lines[lines.length - 1]!) as CronRunLine;
  } catch {
    return undefined;
  }
}

export async function listCronRunFiles(): Promise<string[]> {
  const runsDir = join(getStateRoot(), "cron", "runs");
  try {
    const files = await readdir(runsDir);
    return files.filter((f) => f.endsWith(".jsonl"));
  } catch {
    return [];
  }
}
