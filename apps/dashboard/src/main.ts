import type { ApprovalRequest, GatewayCronEvent, OpenClawStatus, PlanItem, PlanResponse } from "@homebot/shared";
import { exitApp, fetchPlan, fetchStatus, togglePlanItem } from "./api";
import { gateway } from "./gateway/client";
import { formatClock, formatDate, getGreeting } from "./utils/time";
import "./styles/nexus.css";

interface CronPrompt extends GatewayCronEvent {
  dismissed?: boolean;
}

let status: OpenClawStatus | null = null;
let plan: PlanResponse | null = null;
let gatewayOnline = false;
let cronPrompts: CronPrompt[] = [];
let approval: ApprovalRequest | null = null;

const app = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPlanItems(items: PlanItem[], done: boolean): HTMLElement {
  const container = el("div");

  if (items.length === 0) {
    container.appendChild(el("div", "empty-state", done ? "Nothing completed yet" : "No plan yet"));
    return container;
  }

  for (const item of items) {
    const row = el("button", `plan-item${done ? " done-item" : ""}`);
    row.type = "button";

    const check = el("div", "plan-check", done ? "✓" : "");
    row.appendChild(check);

    const textWrap = el("div");
    if (item.time) {
      const time = el("div", "plan-time", item.time);
      textWrap.appendChild(time);
    }
    textWrap.appendChild(el("div", "plan-title", item.title));
    if (item.description) {
      textWrap.appendChild(el("div", "plan-desc", item.description));
    }
    row.appendChild(textWrap);

    if (!done) {
      row.addEventListener("click", async () => {
        try {
          plan = await togglePlanItem(item.index, true);
          render();
        } catch (err) {
          console.error(err);
        }
      });
    } else {
      row.addEventListener("click", async () => {
        try {
          plan = await togglePlanItem(item.index, false);
          render();
        } catch (err) {
          console.error(err);
        }
      });
    }

    container.appendChild(row);
  }

  return container;
}

function renderOverlay(): HTMLElement | null {
  if (approval) {
    const backdrop = el("div", "overlay-backdrop");
    const card = el("div", "overlay-card");
    card.appendChild(el("div", "overlay-title", approval.kind === "exec" ? "EXEC APPROVAL" : "PLUGIN APPROVAL"));
    card.appendChild(el("div", "overlay-body", approval.title));
    if (approval.detail !== approval.title) {
      card.appendChild(el("div", "overlay-meta", approval.detail));
    }

    const actions = el("div", "overlay-actions");
    const approve = el("button", "btn btn-approve", "APPROVE");
    approve.type = "button";
    approve.addEventListener("click", async () => {
      try {
        if (approval!.kind === "exec") {
          await gateway.resolveExecApproval(approval!.requestId, true);
        } else {
          await gateway.resolvePluginApproval(approval!.requestId, true);
        }
        approval = null;
        render();
      } catch (err) {
        console.error(err);
      }
    });

    const deny = el("button", "btn btn-deny", "DENY");
    deny.type = "button";
    deny.addEventListener("click", async () => {
      try {
        if (approval!.kind === "exec") {
          await gateway.resolveExecApproval(approval!.requestId, false);
        } else {
          await gateway.resolvePluginApproval(approval!.requestId, false);
        }
        approval = null;
        render();
      } catch (err) {
        console.error(err);
      }
    });

    actions.appendChild(approve);
    actions.appendChild(deny);
    card.appendChild(actions);
    backdrop.appendChild(card);
    return backdrop;
  }

  const activeCron = cronPrompts.find((p) => !p.dismissed && p.status !== "completed");
  if (activeCron) {
    const backdrop = el("div", "overlay-backdrop");
    const card = el("div", "overlay-card");
    card.appendChild(el("div", "overlay-title", "CRON JOB"));
    card.appendChild(el("div", "overlay-body", activeCron.name ?? activeCron.jobId ?? "Scheduled task"));
    const meta = [activeCron.status, activeCron.message].filter(Boolean).join(" — ");
    if (meta) card.appendChild(el("div", "overlay-meta", meta));

    const actions = el("div", "overlay-actions");
    const dismiss = el("button", "btn btn-dismiss", "DISMISS");
    dismiss.type = "button";
    dismiss.addEventListener("click", () => {
      activeCron.dismissed = true;
      render();
    });
    actions.appendChild(dismiss);
    card.appendChild(actions);
    backdrop.appendChild(card);
    return backdrop;
  }

  return null;
}

function render(): void {
  app.replaceChildren();

  const topBar = el("header", "top-bar");

  const closeBtn = el("button", "close-btn", "✕ CLOSE");
  closeBtn.type = "button";
  closeBtn.title = "Exit dashboard";
  closeBtn.addEventListener("click", () => {
    void exitApp();
  });
  topBar.appendChild(closeBtn);

  const center = el("div", "header-center");
  center.appendChild(el("div", "greeting", getGreeting()));
  center.appendChild(el("div", "date-line", formatDate()));
  topBar.appendChild(center);

  const clock = el("div", "clock", formatClock());
  clock.id = "clock";
  topBar.appendChild(clock);

  app.appendChild(topBar);

  const statusBar = el("div", "status-bar");
  const onlineChip = el("div", `chip ${gatewayOnline ? "online" : "offline"}`);
  onlineChip.appendChild(el("span", "dot"));
  onlineChip.appendChild(document.createTextNode(gatewayOnline ? "Gateway online" : "Gateway offline"));
  statusBar.appendChild(onlineChip);

  const cronCount = status?.cron.enabled ?? 0;
  statusBar.appendChild(el("div", "chip", `${cronCount} cron jobs`));

  const running = status?.tasks.running ?? 0;
  statusBar.appendChild(el("div", "chip", `${running} running`));

  const doneCount = plan?.doneCount ?? 0;
  const total = plan?.total ?? 0;
  statusBar.appendChild(el("div", "chip", `${doneCount}/${total} done`));

  app.appendChild(statusBar);

  const grid = el("main", "main-grid");

  const pendingPanel = el("section", "panel");
  pendingPanel.appendChild(el("div", "panel-header", "TODAY'S PLAN"));
  const pendingBody = el("div", "panel-body");
  pendingBody.appendChild(renderPlanItems(plan?.pending ?? [], false));
  pendingPanel.appendChild(pendingBody);
  grid.appendChild(pendingPanel);

  const donePanel = el("section", "panel");
  donePanel.appendChild(el("div", "panel-header", "DONE TODAY"));
  const doneBody = el("div", "panel-body");
  doneBody.appendChild(renderPlanItems(plan?.done ?? [], true));
  donePanel.appendChild(doneBody);
  grid.appendChild(donePanel);

  app.appendChild(grid);

  const overlay = renderOverlay();
  if (overlay) app.appendChild(overlay);
}

async function refreshData(): Promise<void> {
  try {
    const [s, p] = await Promise.all([fetchStatus(), fetchPlan()]);
    status = s;
    plan = p;
    render();
  } catch (err) {
    console.error("refresh failed", err);
  }
}

function setupGateway(): void {
  gateway.on("connection", (payload) => {
    const p = payload as { connected?: boolean };
    gatewayOnline = Boolean(p.connected);
    render();
  });

  gateway.on("cron", (payload) => {
    const event = gateway.parseCronEvent(payload);
    if (!event.jobId && !event.id) return;
    cronPrompts.unshift(event);
    cronPrompts = cronPrompts.slice(0, 10);
    render();
  });

  gateway.on("exec.approval.requested", (payload) => {
    approval = gateway.parseApproval("exec.approval.requested", payload);
    render();
  });

  gateway.on("plugin.approval.requested", (payload) => {
    approval = gateway.parseApproval("plugin.approval.requested", payload);
    render();
  });

  gateway.connect();
}

function setupClock(): void {
  setInterval(() => {
    const clock = document.getElementById("clock");
    if (clock) clock.textContent = formatClock();
  }, 1000);
}

async function bootstrap(): Promise<void> {
  try {
    if (document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen().catch(() => {});
    }
  } catch {
    /* optional */
  }

  setupGateway();
  setupClock();
  await refreshData();
  setInterval(() => void refreshData(), 60000);
  setInterval(() => {
    if (gateway.isConnected) {
      void gateway.listTasks().catch(() => {});
    }
  }, 30000);
}

void bootstrap();
