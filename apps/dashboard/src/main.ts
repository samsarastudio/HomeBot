import type { CalendarNotification, CheckinSlot, DashboardData, PlanItem } from "@homebot/shared";
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
let checkinsPanelOpen = false;
let lastOverlayKey = "";

const app = document.getElementById("app")!;
const mainRoot = el("div", "dashboard-main");
const overlayRoot = el("div", "overlay-layer");
app.append(mainRoot, overlayRoot);

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

function imageBase(filename: string): string {
  return filename.replace(/\.[^.]+$/, "");
}

function thumbSrc(item: PlanItem): string | undefined {
  if (item.archivedImageUrl) return item.archivedImageUrl;
  if (item.thumbUrl) return item.thumbUrl;
  if (item.image) return `/api/media/thumb/${encodeURIComponent(imageBase(item.image))}?size=small`;
  return item.imageUrl;
}

function fullImageSrc(item: PlanItem): string | undefined {
  if (item.archivedImageUrl) return item.archivedImageUrl;
  if (item.imageUrl) return item.imageUrl;
  if (item.image) return `/api/media/image/${encodeURIComponent(item.image)}`;
  return undefined;
}

function itemHasImage(item: PlanItem): boolean {
  return Boolean(item.image || item.thumbUrl || item.imageUrl || item.archivedImageUrl);
}

function findPlanItem(data: DashboardData, index: number): PlanItem | undefined {
  return data.todolist.plan.items.find((i) => i.index === index);
}

function thumbForItem(item: PlanItem): HTMLElement {
  const wrap = el("div", "plan-thumb");
  const src = thumbSrc(item);
  if (src) {
    const img = document.createElement("img");
    img.className = "plan-thumb-img";
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", () => {
      const fallback = fullImageSrc(item);
      if (fallback && img.src !== fallback) {
        img.src = fallback;
        return;
      }
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
      } catch (err) {
        console.error(err);
      }
    });

    const body = el("button", "plan-body");
    body.type = "button";

    if (itemHasImage(item) || item.attachment) {
      body.appendChild(thumbForItem(item));
    }

    const textWrap = el("div", "plan-text");
    if (item.time) textWrap.appendChild(el("div", "plan-time", item.time));
    textWrap.appendChild(el("div", "plan-title", item.title));
    if (item.description) textWrap.appendChild(el("div", "plan-desc", item.description));
    body.appendChild(textWrap);

    body.addEventListener("click", () => {
      detailItem = item;
      renderOverlay(true);
    });

    row.appendChild(check);
    row.appendChild(body);
    container.appendChild(row);
  }

  return container;
}

function appendDetailImage(body: HTMLElement, item: PlanItem): void {
  const src = fullImageSrc(item);
  if (!src) return;

  const img = document.createElement("img");
  img.className = "detail-image";
  img.src = src;
  img.alt = item.title;
  img.addEventListener("error", () => {
    img.style.display = "none";
  });
  body.appendChild(img);
}

function renderDetailOverlay(): HTMLElement | null {
  if (!detailItem) return null;

  const backdrop = el("div", "overlay-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      detailItem = null;
      renderOverlay(true);
    }
  });

  const card = el("div", "overlay-card detail-card");
  const header = el("div", "detail-header");
  header.appendChild(el("div", "overlay-title", "TASK DETAIL"));
  const close = el("button", "detail-close", "✕");
  close.type = "button";
  close.addEventListener("click", () => {
    detailItem = null;
    renderOverlay(true);
  });
  header.appendChild(close);
  card.appendChild(header);

  const body = el("div", "detail-card-body scroll-themed");
  if (detailItem.time) body.appendChild(el("div", "detail-time", detailItem.time));
  body.appendChild(el("div", "detail-title", detailItem.title));
  if (detailItem.description) body.appendChild(el("div", "detail-desc", detailItem.description));
  appendDetailImage(body, detailItem);

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
      renderOverlay(true);
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

  if (activeNotification.thumbUrl || activeNotification.imageUrl) {
    const img = document.createElement("img");
    img.className = "notification-thumb";
    img.src = activeNotification.thumbUrl ?? activeNotification.imageUrl!;
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
    renderOverlay(true);
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
      renderOverlay(true);
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
      renderOverlay(true);
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
    renderOverlay(true);
  });
  const actions = el("div", "overlay-actions");
  actions.appendChild(dismiss);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function overlayKey(): string {
  if (approval) return `approval:${approval.requestId}`;
  if (activeNotification) return `notif:${activeNotification.id}`;
  if (checkinsPanelOpen) return "checkins:open";
  if (detailItem) return `detail:${detailItem.index}:${detailItem.done}:${detailItem.title}`;
  const activeCron = cronPrompts.find((p) => !p.dismissed && p.status !== "completed");
  if (activeCron) return `cron:${activeCron.jobId ?? activeCron.id}`;
  return "";
}

function buildOverlay(): HTMLElement | null {
  return (
    renderApprovalOverlay() ??
    renderNotificationOverlay() ??
    renderCheckinsOverlay() ??
    (detailItem ? renderDetailOverlay() : null) ??
    renderCronOverlay()
  );
}

function renderOverlay(force = false): void {
  const key = overlayKey();
  if (!force && key === lastOverlayKey) return;
  lastOverlayKey = key;
  overlayRoot.replaceChildren();
  const overlay = buildOverlay();
  if (overlay) overlayRoot.appendChild(overlay);
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function checkinStatus(slot: CheckinSlot, now = Date.now()): "past" | "now" | "soon" | "upcoming" {
  const start = new Date(slot.startAt).getTime();
  const diff = start - now;
  if (diff < -5 * 60_000) return "past";
  if (diff <= 5 * 60_000) return "now";
  if (diff <= 30 * 60_000) return "soon";
  return "upcoming";
}

function renderCheckinItemRow(item: PlanItem): HTMLElement {
  const row = el("button", `checkin-item-row${item.done ? " is-done" : ""}`);
  row.type = "button";
  row.appendChild(el("span", "checkin-item-mark", item.done ? "✓" : "○"));
  const text = el("div", "checkin-item-text");
  if (item.time) text.appendChild(el("span", "checkin-item-time", item.time));
  text.appendChild(el("span", "checkin-item-title", item.title));
  row.appendChild(text);
  row.addEventListener("click", () => {
    detailItem = item;
    checkinsPanelOpen = false;
    renderOverlay(true);
  });
  return row;
}

function renderCheckinsOverlay(): HTMLElement | null {
  if (!checkinsPanelOpen) return null;

  const backdrop = el("div", "overlay-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      checkinsPanelOpen = false;
      renderOverlay(true);
    }
  });

  const card = el("div", "overlay-card checkins-detail-card");
  const header = el("div", "detail-header");
  header.appendChild(el("div", "overlay-title", "TODAY'S CHECK-INS"));
  const close = el("button", "detail-close", "✕");
  close.type = "button";
  close.addEventListener("click", () => {
    checkinsPanelOpen = false;
    renderOverlay(true);
  });
  header.appendChild(close);
  card.appendChild(header);

  const body = el("div", "checkins-detail-body scroll-themed");
  const slots = dashboard?.checkins ?? [];

  for (const slot of slots) {
    const section = el("div", `checkin-section checkin-${checkinStatus(slot)}`);
    const head = el("div", "checkin-section-head");
    head.appendChild(el("span", "checkin-section-time", slot.time));
    head.appendChild(el("span", "checkin-section-label", slot.label));
    const tag = slot.kind === "work" ? "WORK" : "PERSONAL";
    head.appendChild(el("span", "checkin-section-tag", tag));
    head.appendChild(el("span", "checkin-section-count", `${slot.pendingCount} pending`));
    section.appendChild(head);

    const list = el("div", "checkin-section-list");
    if (slot.pending.length === 0 && slot.done.length === 0) {
      list.appendChild(el("div", "checkin-section-empty", "No items — tag plan lines with {personal} or {work}"));
    } else {
      for (const item of slot.pending) list.appendChild(renderCheckinItemRow(item));
      for (const item of slot.done) list.appendChild(renderCheckinItemRow(item));
    }
    section.appendChild(list);
    body.appendChild(section);
  }

  card.appendChild(body);
  backdrop.appendChild(card);
  return backdrop;
}

function renderMarquee(): HTMLElement {
  const bar = el("button", "checkin-marquee");
  bar.type = "button";
  bar.title = "Tap to open check-ins";

  const label = el("span", "marquee-label", "CHECK-INS");
  bar.appendChild(label);

  const viewport = el("div", "marquee-viewport");
  const track = el("div", "marquee-track");
  const text =
    dashboard?.checkin_marquee ||
    "9:00 AM · personal   ◆   6:00 PM · personal   ◆   11:30 PM · work — tap to view";
  track.appendChild(el("span", "marquee-text", text));
  track.appendChild(el("span", "marquee-text", text));
  viewport.appendChild(track);
  bar.appendChild(viewport);

  bar.addEventListener("click", () => {
    checkinsPanelOpen = true;
    renderOverlay(true);
  });

  return bar;
}

function renderInfoStrip(): HTMLElement {
  const strip = el("div", "info-strip scroll-themed");
  const gw = el("span", `info-chip ${gatewayOnline ? "online" : "offline"}`);
  gw.id = "gateway-chip";
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

function renderMain(): void {
  mainRoot.replaceChildren();

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

  mainRoot.appendChild(topBar);
  mainRoot.appendChild(renderInfoStrip());
  mainRoot.appendChild(renderMarquee());

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

  mainRoot.appendChild(grid);
}

function applyDashboardData(data: DashboardData): void {
  dashboard = data;
  gatewayOnline = data.gateway.online;

  if (detailItem) {
    detailItem = findPlanItem(data, detailItem.index) ?? detailItem;
  }

  if (!activeNotification && data.pending_notifications.length > 0) {
    activeNotification = data.pending_notifications[0]!;
    renderOverlay(true);
  }

  renderMain();
  renderOverlay();
}

function bootstrap(): void {
  ensureFullscreen();
  setupGateway();
  setupClock();

  startLiveDashboard(
    (data) => applyDashboardData(data),
    (notification) => {
      activeNotification = notification;
      renderOverlay(true);
    },
    5000,
  );
}

function setupGateway(): void {
  gateway.on("cron", (payload) => {
    const event = gateway.parseCronEvent(payload);
    if (!event.jobId && !event.id) return;
    cronPrompts.unshift({ ...event, dismissed: false });
    cronPrompts = cronPrompts.slice(0, 10);
    renderOverlay(true);
  });

  gateway.on("exec.approval.requested", (payload) => {
    approval = gateway.parseApproval("exec.approval.requested", payload);
    renderOverlay(true);
  });

  gateway.on("plugin.approval.requested", (payload) => {
    approval = gateway.parseApproval("plugin.approval.requested", payload);
    renderOverlay(true);
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
