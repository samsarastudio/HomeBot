import type { CalendarNotification, DashboardData, PlanItem } from "@homebot/shared";
import { dismissNotification, exitApp, togglePlanItem } from "./api";
import { gateway } from "./gateway/client";
import { startLiveDashboard } from "./live-dashboard";
import { ensureFullscreen } from "./fullscreen";
import { formatClock, formatDate, getGreeting } from "./utils/time";
import "./styles/nexus.css";

interface CronPrompt {
  id?: string;
  jobId?: string;
  name?: string;
  status?: string;
  message?: string;
  dismissed?: boolean;
}

let dashboard: DashboardData | null = null;
let gatewayOnline = false;
let cronPrompts: CronPrompt[] = [];
let approval: import("@homebot/shared").ApprovalRequest | null = null;
let detailItem: PlanItem | null = null;
let activeNotification: CalendarNotification | null = null;

const app = document.getElementById("app")!;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function thumbForItem(item: PlanItem): HTMLElement {
  const wrap = el("div", "plan-thumb");
  if (item.thumbUrl) {
    const img = document.createElement("img");
    img.className = "plan-thumb-img";
    img.src = item.thumbUrl;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      img.replaceWith(el("div", "plan-thumb-fallback", "◇"));
    });
    wrap.appendChild(img);
  } else if (item.attachment) {
    wrap.appendChild(el("div", "plan-thumb-fallback", "📎"));
  }
  return wrap;
}

function renderPlanItems(items: PlanItem[], done: boolean): HTMLElement {
  const container = el("div");

  if (items.length === 0) {
    container.appendChild(el("div", "empty-state", done ? "Nothing completed yet" : "No plan yet"));
    return container;
  }

  for (const item of items) {
    const row = el("div", `plan-item${done ? " done-item" : ""}`);

    const check = el("button", `plan-check${done ? " is-done" : ""}`, done ? "✓" : "");
    check.type = "button";
    check.title = done ? "Mark pending" : "Mark done";
    check.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      check.classList.add("pulse");
      try {
        await togglePlanItem(item.index, !done);
        render();
      } catch (err) {
        console.error(err);
      }
    });

    const body = el("button", "plan-body");
    body.type = "button";

    if (item.thumbUrl || item.attachment) {
      body.appendChild(thumbForItem(item));
    }

    const textWrap = el("div", "plan-text");
    if (item.time) textWrap.appendChild(el("div", "plan-time", item.time));
    textWrap.appendChild(el("div", "plan-title", item.title));
    if (item.description) textWrap.appendChild(el("div", "plan-desc", item.description));
    body.appendChild(textWrap);

    body.addEventListener("click", () => {
      detailItem = item;
      render();
    });

    row.appendChild(check);
    row.appendChild(body);
    container.appendChild(row);
  }

  return container;
}

function renderDetailOverlay(): HTMLElement | null {
  if (!detailItem) return null;

  const backdrop = el("div", "overlay-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      detailItem = null;
      render();
    }
  });

  const card = el("div", "overlay-card detail-card");
  const header = el("div", "detail-header");
  header.appendChild(el("div", "overlay-title", "TASK DETAIL"));
  const close = el("button", "detail-close", "✕");
  close.type = "button";
  close.addEventListener("click", () => {
    detailItem = null;
    render();
  });
  header.appendChild(close);
  card.appendChild(header);

  const body = el("div", "detail-card-body scroll-themed");
  if (detailItem.time) body.appendChild(el("div", "detail-time", detailItem.time));
  body.appendChild(el("div", "detail-title", detailItem.title));
  if (detailItem.description) body.appendChild(el("div", "detail-desc", detailItem.description));

  if (detailItem.imageUrl) {
    const img = document.createElement("img");
    img.className = "detail-image";
    img.src = detailItem.imageUrl.replace("size=small", "").replace("/thumb/", "/image/") ||
      detailItem.imageUrl;
    if (detailItem.image) {
      img.src = `/api/media/image/${encodeURIComponent(detailItem.image)}`;
    }
    body.appendChild(img);
  }

  if (detailItem.attachmentUrl) {
    const link = el("a", "detail-attachment", `Attachment: ${detailItem.attachment}`);
    link.href = detailItem.attachmentUrl;
    link.target = "_blank";
    body.appendChild(link);
  }

  body.appendChild(el("div", "detail-meta", `Index ${detailItem.index} · ${detailItem.done ? "Done" : "Pending"}`));

  const actions = el("div", "overlay-actions");
  const toggleBtn = el("button", "btn btn-dismiss", detailItem.done ? "MARK PENDING" : "MARK DONE");
  toggleBtn.type = "button";
  toggleBtn.addEventListener("click", async () => {
    try {
      await togglePlanItem(detailItem!.index, !detailItem!.done);
      detailItem = null;
      render();
    } catch (err) {
      console.error(err);
    }
  });
  actions.appendChild(toggleBtn);
  card.appendChild(body);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderNotificationOverlay(): HTMLElement | null {
  if (!activeNotification) return null;

  const backdrop = el("div", "overlay-backdrop notification-backdrop");
  const card = el("div", "overlay-card notification-card");
  const kindLabel = activeNotification.kind === "upcoming" ? "UPCOMING" : "NOW";
  card.appendChild(el("div", "overlay-title", kindLabel));

  if (activeNotification.thumbUrl) {
    const img = document.createElement("img");
    img.className = "notification-thumb";
    img.src = activeNotification.thumbUrl;
    img.alt = "";
    card.appendChild(img);
  }

  card.appendChild(el("div", "overlay-body", activeNotification.title));
  if (activeNotification.notes) {
    card.appendChild(el("div", "overlay-meta", activeNotification.notes));
  }
  const time = new Date(activeNotification.startAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  card.appendChild(el("div", "overlay-meta", `Scheduled ${time}`));

  const actions = el("div", "overlay-actions");
  const dismiss = el("button", "btn btn-dismiss", "DISMISS");
  dismiss.type = "button";
  dismiss.addEventListener("click", async () => {
    const id = activeNotification!.id;
    activeNotification = null;
    await dismissNotification(id).catch(() => {});
    render();
  });
  actions.appendChild(dismiss);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderApprovalOverlay(): HTMLElement | null {
  if (!approval) return null;

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
      if (approval!.kind === "exec") await gateway.resolveExecApproval(approval!.requestId, true);
      else await gateway.resolvePluginApproval(approval!.requestId, true);
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
      if (approval!.kind === "exec") await gateway.resolveExecApproval(approval!.requestId, false);
      else await gateway.resolvePluginApproval(approval!.requestId, false);
      approval = null;
      render();
    } catch (err) {
      console.error(err);
    }
  });
  actions.append(approve, deny);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderCronOverlay(): HTMLElement | null {
  const activeCron = cronPrompts.find((p) => !p.dismissed && p.status !== "completed");
  if (!activeCron) return null;

  const backdrop = el("div", "overlay-backdrop");
  const card = el("div", "overlay-card");
  card.appendChild(el("div", "overlay-title", "CRON JOB"));
  card.appendChild(el("div", "overlay-body", activeCron.name ?? activeCron.jobId ?? "Scheduled task"));
  const meta = [activeCron.status, activeCron.message].filter(Boolean).join(" — ");
  if (meta) card.appendChild(el("div", "overlay-meta", meta));

  const dismiss = el("button", "btn btn-dismiss", "DISMISS");
  dismiss.type = "button";
  dismiss.addEventListener("click", () => {
    activeCron.dismissed = true;
    render();
  });
  const actions = el("div", "overlay-actions");
  actions.appendChild(dismiss);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderInfoStrip(): HTMLElement {
  const strip = el("div", "info-strip scroll-themed");
  const gw = el("span", `info-chip ${gatewayOnline ? "online" : "offline"}`);
  gw.appendChild(el("span", "dot"));
  gw.appendChild(document.createTextNode(gatewayOnline ? "ONLINE" : "OFFLINE"));
  strip.appendChild(gw);

  const cronCount = dashboard?.cron_jobs.filter((j) => j.enabled).length ?? 0;
  strip.appendChild(el("span", "info-chip", `CRON ${cronCount}`));
  strip.appendChild(el("span", "info-chip", `RUN ${dashboard?.tasks.running ?? 0}`));

  const done = dashboard?.todolist.completed ?? 0;
  const pending = dashboard?.todolist.pending ?? 0;
  strip.appendChild(el("span", "info-chip", `${done}/${done + pending}`));

  const sys = dashboard?.system;
  if (sys) {
    strip.appendChild(el("span", "info-chip", `CPU ${sys.cpu}`));
    strip.appendChild(el("span", "info-chip", `RAM ${sys.ram}`));
    strip.appendChild(el("span", "info-chip", `DISK ${sys.disk}`));
  }

  return strip;
}

function render(): void {
  app.replaceChildren();

  const topBar = el("header", "top-bar");

  const closeBtn = el("button", "close-btn", "✕");
  closeBtn.type = "button";
  closeBtn.title = "Exit dashboard";
  closeBtn.setAttribute("aria-label", "Exit");
  closeBtn.addEventListener("click", () => void exitApp());
  topBar.appendChild(closeBtn);

  const center = el("div", "header-center");
  center.appendChild(el("div", "greeting", getGreeting()));
  center.appendChild(el("div", "date-line", formatDate()));
  topBar.appendChild(center);

  const clock = el("div", "clock", formatClock());
  clock.id = "clock";
  topBar.appendChild(clock);

  app.appendChild(topBar);
  app.appendChild(renderInfoStrip());

  const grid = el("main", "main-grid");

  const pendingPanel = el("section", "panel");
  pendingPanel.appendChild(el("div", "panel-header", "TODAY'S PLAN"));
  const pendingBody = el("div", "panel-body scroll-themed");
  pendingBody.appendChild(renderPlanItems(dashboard?.todolist.plan.pending ?? [], false));
  pendingPanel.appendChild(pendingBody);
  grid.appendChild(pendingPanel);

  const donePanel = el("section", "panel");
  donePanel.appendChild(el("div", "panel-header", "DONE TODAY"));
  const doneBody = el("div", "panel-body scroll-themed");
  doneBody.appendChild(renderPlanItems(dashboard?.todolist.plan.done ?? [], true));
  donePanel.appendChild(doneBody);
  grid.appendChild(donePanel);

  app.appendChild(grid);

  // Priority: approval > notification > detail > cron
  const overlay =
    renderApprovalOverlay() ??
    renderNotificationOverlay() ??
    (detailItem ? renderDetailOverlay() : null) ??
    renderCronOverlay();

  if (overlay) app.appendChild(overlay);
}

function bootstrap(): void {
  ensureFullscreen();
  setupGateway();
  setupClock();

  startLiveDashboard(
    (data) => {
      dashboard = data;
      gatewayOnline = data.gateway.online;
      if (!activeNotification && data.pending_notifications.length > 0) {
        activeNotification = data.pending_notifications[0]!;
      }
      render();
    },
    (notification) => {
      activeNotification = notification;
      render();
    },
    5000,
  );
}

function setupGateway(): void {
  gateway.on("connection", (payload) => {
    gatewayOnline = Boolean((payload as { connected?: boolean }).connected);
    render();
  });

  gateway.on("cron", (payload) => {
    const event = gateway.parseCronEvent(payload);
    if (!event.jobId && !event.id) return;
    cronPrompts.unshift({ ...event, dismissed: false });
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

void bootstrap();
