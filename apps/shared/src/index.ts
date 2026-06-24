export interface PlanItem {
  index: number;
  time?: string;
  title: string;
  description?: string;
  done: boolean;
  raw: string;
}

export interface PlanResponse {
  date: string;
  path: string;
  exists: boolean;
  items: PlanItem[];
  pending: PlanItem[];
  done: PlanItem[];
  total: number;
  doneCount: number;
}

export interface CronJobSummary {
  jobId: string;
  name: string;
  enabled: boolean;
  schedule?: string;
  lastStatus?: string;
  lastRunAt?: string;
}

export interface TaskSummary {
  id: string;
  status: string;
  kind?: string;
  title?: string;
  runtime?: string;
  startedAt?: string;
  updatedAt?: string;
}

export interface OpenClawStatus {
  stateDir: string;
  gateway: {
    reachable: boolean;
    port: number;
  };
  config: {
    cronEnabled?: boolean;
    agentName?: string;
  };
  cron: {
    total: number;
    enabled: number;
    jobs: CronJobSummary[];
  };
  tasks: {
    running: number;
    queued: number;
    recent: TaskSummary[];
  };
  plan: {
    total: number;
    done: number;
  };
}

export interface GatewayCronEvent {
  id?: string;
  jobId?: string;
  name?: string;
  status?: string;
  message?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface ApprovalRequest {
  requestId: string;
  kind: "exec" | "plugin";
  title: string;
  detail: string;
  requestedAt?: number;
}

export interface FileListItem {
  name: string;
  type: "image" | "document" | "attachment";
  size: string;
  url: string;
  thumbUrl?: string;
}

export interface DashboardData {
  todolist: {
    completed: number;
    pending: number;
    plan: PlanResponse;
  };
  sessions: {
    active: number;
    total: number;
  };
  system: {
    cpu: string;
    ram: string;
    disk: string;
  };
  cron_jobs: CronJobSummary[];
  gateway: {
    online: boolean;
    port: number;
  };
  tasks: OpenClawStatus["tasks"];
  openclaw: OpenClawStatus;
  timestamp: string;
}
