export type PlanCategory = "work" | "personal";

export interface PlanItem {
  index: number;
  time?: string;
  title: string;
  description?: string;
  done: boolean;
  raw: string;
  category?: PlanCategory;
  important?: boolean;
  dueDate?: string;
  addedAt?: string;
  carryFrom?: string;
  carriedDays?: number;
  carryBand?: "orange" | "red";
  overdue?: boolean;
  image?: string;
  attachment?: string;
  thumbUrl?: string;
  imageUrl?: string;
  attachmentUrl?: string;
  archivedImageUrl?: string;
}

export interface PlanUpdatePayload {
  index: number;
  done?: boolean;
  time?: string | null;
  dueDate?: string | null;
  category?: PlanCategory;
  important?: boolean;
  title?: string;
  description?: string | null;
}

export interface PlanCreatePayload {
  title: string;
  description?: string;
  time?: string;
  dueDate?: string;
  category?: PlanCategory;
  important?: boolean;
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

export interface CalendarEvent {
  id: string;
  title: string;
  startAt: string;
  notes?: string;
  image?: string;
  remindMinutes: number[];
  thumbUrl?: string;
  imageUrl?: string;
}

export interface CalendarNotification {
  id: string;
  eventId: string;
  kind: "upcoming" | "start";
  title: string;
  startAt: string;
  notes?: string;
  imageUrl?: string;
  thumbUrl?: string;
}

export interface ArchiveStatus {
  lastRun?: string;
  lastBytesSaved?: number;
  lastFilesArchived?: number;
  lastError?: string;
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
  events: CalendarEvent[];
  pending_notifications: CalendarNotification[];
  openclaw: OpenClawStatus;
  timestamp: string;
}
