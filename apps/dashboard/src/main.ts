import type { CalendarEvent, CalendarNotification, DashboardData, PlanCategory, PlanItem } from "@homebot/shared";
import {
  createPlanItem,
  deferPlanItem,
  deletePlanItem,
  dismissNotification,
  exitApp,
  snoozeNotification,
  togglePlanItem,
  updatePlanItem,
} from "./api";
import { gateway } from "./gateway/client";
import { startLiveDashboard } from "./live-dashboard";
import { ensureFullscreen } from "./fullscreen";
import { initLayoutDetection, is7inLayout, isNightDeskHour, tapMoveThreshold } from "./layout";
import { findNextTimedItem, formatNowNextText } from "./now-next";
import { formatClock, formatDate, getGreeting } from "./utils/time";
import { formatAgeMinutes, isItemOverdue, sortPlanItems } from "./plan-utils";
import { createTouchCalendarPicker, createTouchClockPicker } from "./touch-pickers";
import { showToast } from "./toast";
import "./styles/nexus.css";

interface CronPrompt {
  id?: string;
  jobId?: string;
  name?: string;
  status?: string;
  message?: string;
  dismissed?: boolean;
}

type PlanFilter = "all" | PlanCategory;

let dashboard: DashboardData | null = null;
let gatewayOnline = false;
let cronPrompts: CronPrompt[] = [];
let approval: import("@homebot/shared").ApprovalRequest | null = null;
let detailItem: PlanItem | null = null;
let activeNotification: CalendarNotification | null = null;
let planFilter: PlanFilter = "all";
let planTab: "pending" | "done" = "pending";
let apiOnline = true;
let infoStripExpanded = false;
let captureOpen = false;
let focusItem: PlanItem | null = null;
let notificationQueue: CalendarNotification[] = [];
let lastOverlayKey = "";
let lastPlanKey = "";
let mainShellBuilt = false;
let pendingBodyEl: HTMLElement | null = null;
let doneBodyEl: HTMLElement | null = null;
let pendingHeaderEl: HTMLElement | null = null;
let doneHeaderEl: HTMLElement | null = null;
let gatewayChipEl: HTMLElement | null = null;
let cronChipEl: HTMLElement | null = null;
let runChipEl: HTMLElement | null = null;
let countChipEl: HTMLElement | null = null;
let cpuChipEl: HTMLElement | null = null;
let ramChipEl: HTMLElement | null = null;
let diskChipEl: HTMLElement | null = null;
let infoStripEl: HTMLElement | null = null;
let infoStripDetailEl: HTMLElement | null = null;
let nowNextEl: HTMLElement | null = null;
let eventsRibbonEl: HTMLElement | null = null;
let offlineBannerEl: HTMLElement | null = null;
let planTabPendingBtn: HTMLElement | null = null;
let planTabDoneBtn: HTMLElement | null = null;
let pendingPanelEl: HTMLElement | null = null;
let donePanelEl: HTMLElement | null = null;
let fabEl: HTMLElement | null = null;
let focusTimerId = 0;
const addedAtCache = new Map<string, string>();

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

function todayYmd(): string {
  return dashboard?.todolist.plan.date ?? new Date().toISOString().slice(0, 10);
}

function filterItems(items: PlanItem[]): PlanItem[] {
  const sorted = sortPlanItems(items, todayYmd());
  if (planFilter === "all") return sorted;
  return sorted.filter((i) => (i.category ?? "personal") === planFilter);
}

function addedAtStorageKey(item: PlanItem): string {
  return `homebot-added-${todayYmd()}:${item.index}`;
}

function getItemAddedAt(item: PlanItem): string {
  if (item.addedAt) return item.addedAt;
  const key = addedAtStorageKey(item);
  if (addedAtCache.has(key)) return addedAtCache.get(key)!;
  try {
    const stored = sessionStorage.getItem(key);
    if (stored) {
      addedAtCache.set(key, stored);
      return stored;
    }
  } catch {
    /* private mode */
  }
  const now = new Date().toISOString();
  addedAtCache.set(key, now);
  try {
    sessionStorage.setItem(key, now);
  } catch {
    /* ignore */
  }
  return now;
}

function planDataKey(): string {
  if (!dashboard) return "";
  const plan = dashboard.todolist.plan;
  const snap = (items: PlanItem[]) =>
    items.map((i) => ({
      index: i.index,
      done: i.done,
      time: i.time,
      dueDate: i.dueDate,
      title: i.title,
      category: i.category,
      important: i.important,
      addedAt: i.addedAt,
      carryFrom: i.carryFrom,
    }));
  return JSON.stringify({
    filter: planFilter,
    pending: snap(plan.pending),
    done: snap(plan.done),
  });
}

function preservePanelScroll(): Record<string, number> {
  const tops: Record<string, number> = {};
  for (const panel of mainRoot.querySelectorAll<HTMLElement>(".panel-body[data-scroll-id]")) {
    const id = panel.dataset.scrollId;
    if (id) tops[id] = panel.scrollTop;
  }
  return tops;
}

function restorePanelScroll(tops: Record<string, number>): void {
  for (const panel of mainRoot.querySelectorAll<HTMLElement>(".panel-body[data-scroll-id]")) {
    const id = panel.dataset.scrollId;
    if (id && tops[id] !== undefined) panel.scrollTop = tops[id];
  }
}

function attachPanelScrollGuard(panel: HTMLElement): void {
  let timer = 0;
  panel.addEventListener(
    "scroll",
    () => {
      panel.dataset.scrolling = "1";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        delete panel.dataset.scrolling;
      }, 200);
    },
    { passive: true },
  );
}

function bindTapOpen(target: HTMLElement, item: PlanItem, scrollParent: HTMLElement): void {
  let startY = 0;
  let startX = 0;
  const threshold = () => tapMoveThreshold();

  target.addEventListener(
    "touchstart",
    (e) => {
      startY = e.touches[0]!.clientY;
      startX = e.touches[0]!.clientX;
    },
    { passive: true },
  );

  target.addEventListener("touchend", (e) => {
    if (scrollParent.dataset.scrolling === "1") return;
    const dy = Math.abs(e.changedTouches[0]!.clientY - startY);
    const dx = Math.abs(e.changedTouches[0]!.clientX - startX);
    if (dy > threshold() || dx > threshold()) return;
    openDetail(item);
  });

  target.addEventListener("click", (e) => {
    if (e.detail === 0) return;
    if (scrollParent.dataset.scrolling === "1") return;
    openDetail(item);
  });
}

function bindSwipeGestures(
  row: HTMLElement,
  item: PlanItem,
  done: boolean,
  scrollParent: HTMLElement,
): void {
  if (done) return;
  let startX = 0;
  let startY = 0;
  let tracking = false;

  row.addEventListener(
    "touchstart",
    (e) => {
      if (scrollParent.dataset.scrolling === "1") return;
      startX = e.touches[0]!.clientX;
      startY = e.touches[0]!.clientY;
      tracking = true;
      row.style.transition = "none";
    },
    { passive: true },
  );

  row.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking) return;
      const dx = e.touches[0]!.clientX - startX;
      const dy = Math.abs(e.touches[0]!.clientY - startY);
      if (dy > 20) {
        tracking = false;
        row.style.transform = "";
        return;
      }
      if (Math.abs(dx) > 8) row.style.transform = `translateX(${dx}px)`;
    },
    { passive: true },
  );

  row.addEventListener("touchend", (e) => {
    if (!tracking) return;
    tracking = false;
    row.style.transition = "";
    const dx = e.changedTouches[0]!.clientX - startX;
    row.style.transform = "";
    if (dx > 80) {
      void togglePlanItem(item.index, true).catch((err) => showToast(String(err), "error"));
      return;
    }
    if (dx < -80) {
      void deferPlanItem(item.index).catch((err) => showToast(String(err), "error"));
    }
  });
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

function openDetail(item: PlanItem): void {
  detailItem = item;
  renderOverlay(true);
}

function thumbForItem(item: PlanItem): HTMLElement {
  const wrap = el("div", "plan-thumb");
  const src = thumbSrc(item);
  if (src) {
    const img = document.createElement("img");
    img.className = "plan-thumb-img";
    img.src = src;
    img.alt = "";
    img.draggable = false;
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

function renderPlanItems(items: PlanItem[], done: boolean, scrollParent: HTMLElement): HTMLElement {
  const container = el("div", "plan-list");
  const filtered = filterItems(items);

  if (filtered.length === 0) {
    const msg =
      planFilter === "all"
        ? done
          ? "Nothing completed yet"
          : "No plan yet"
        : `No ${planFilter} items`;
    container.appendChild(el("div", "empty-state", msg));
    return container;
  }

  const ymd = todayYmd();

  for (const item of filtered) {
    const overdue = isItemOverdue(item, ymd);
    const carryClass =
      !done && item.carryBand === "red"
        ? " carry-red"
        : !done && item.carryBand === "orange"
          ? " carry-orange"
          : "";
    const row = el(
      "div",
      `plan-item${done ? " done-item" : ""}${overdue ? " overdue" : ""}${carryClass}${item.important ? " important" : ""}`,
    );

    const check = el("button", `plan-check${done ? " is-done" : ""}`, done ? "✓" : "");
    check.type = "button";
    check.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      check.classList.add("pulse");
      try {
        await togglePlanItem(item.index, !done);
      } catch (err) {
        showToast(String(err), "error");
      }
    });

    const body = el("div", "plan-body");

    if (itemHasImage(item) || item.attachment) {
      body.appendChild(thumbForItem(item));
    }

    const textWrap = el("div", "plan-text");
    const meta = el("div", "plan-meta-row");

    if (item.time) meta.appendChild(el("span", `plan-time${overdue && !done ? " overdue-text" : ""}`, item.time));
    if (!done && item.dueDate) {
      const d = item.dueDate.slice(5).replace("-", "/");
      meta.appendChild(el("span", `plan-date${overdue ? " overdue-text" : ""}`, d));
    }
    if (!done && item.important) meta.appendChild(el("span", "plan-badge important", "★"));
    if (!done && item.category === "work") meta.appendChild(el("span", "plan-badge work", "WORK"));
    if (!done && item.carryFrom) {
      const label =
        item.carriedDays === 1
          ? "YESTERDAY"
          : `FROM ${item.carryFrom.slice(5).replace("-", "/")}`;
      meta.appendChild(el("span", `plan-badge carry${item.carryBand === "red" ? " carry-late" : ""}`, label));
    }
    if (!done) {
      const addedAt = getItemAddedAt(item);
      const age = el("span", "plan-age");
      age.dataset.addedAt = addedAt;
      age.textContent = formatAgeMinutes(addedAt);
      meta.appendChild(age);
    }
    if (meta.childElementCount > 0) textWrap.appendChild(meta);

    textWrap.appendChild(el("div", `plan-title${overdue && !done ? " overdue-text" : ""}`, item.title));
    if (!done && item.description) textWrap.appendChild(el("div", "plan-desc", item.description));
    body.appendChild(textWrap);

    bindTapOpen(body, item, scrollParent);
    bindSwipeGestures(row, item, done, scrollParent);

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
  img.draggable = false;
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
  header.appendChild(el("div", "overlay-title", "EDIT TASK"));
  const close = el("button", "detail-close", "✕");
  close.type = "button";
  close.addEventListener("click", () => {
    detailItem = null;
    renderOverlay(true);
  });
  header.appendChild(close);
  card.appendChild(header);

  const body = el("div", "detail-card-body");

  body.appendChild(el("div", "picker-section-label", "TITLE"));
  const titleInput = document.createElement("input");
  titleInput.className = "detail-title-input";
  titleInput.type = "text";
  titleInput.value = detailItem.title;
  body.appendChild(titleInput);

  body.appendChild(el("div", "picker-section-label", "DESCRIPTION"));
  const descInput = document.createElement("textarea");
  descInput.className = "detail-desc-input";
  descInput.rows = 2;
  descInput.value = detailItem.description ?? "";
  body.appendChild(descInput);

  body.appendChild(el("div", "picker-section-label", "TIME"));
  const clock = createTouchClockPicker(detailItem.time);
  body.appendChild(clock.element);

  body.appendChild(el("div", "picker-section-label", "DATE"));
  const cal = createTouchCalendarPicker(detailItem.dueDate ?? null);
  body.appendChild(cal.element);

  const tagRow = el("div", "detail-tag-row");
  let category: PlanCategory = detailItem.category ?? "personal";
  let important = Boolean(detailItem.important);

  const personalBtn = el("button", "filter-chip", "PERSONAL");
  const workBtn = el("button", "filter-chip", "WORK");
  const importantBtn = el("button", "filter-chip", "★ IMPORTANT");
  personalBtn.type = "button";
  workBtn.type = "button";
  importantBtn.type = "button";

  const syncTags = () => {
    personalBtn.classList.toggle("active", category === "personal");
    workBtn.classList.toggle("active", category === "work");
    importantBtn.classList.toggle("active", important);
  };
  personalBtn.addEventListener("click", () => {
    category = "personal";
    syncTags();
  });
  workBtn.addEventListener("click", () => {
    category = "work";
    syncTags();
  });
  importantBtn.addEventListener("click", () => {
    important = !important;
    syncTags();
  });
  syncTags();
  tagRow.append(personalBtn, workBtn, importantBtn);
  body.appendChild(tagRow);

  appendDetailImage(body, detailItem);

  if (detailItem.attachmentUrl) {
    const link = el("a", "detail-attachment", `Attachment: ${detailItem.attachment}`);
    link.href = detailItem.attachmentUrl;
    link.target = "_blank";
    body.appendChild(link);
  }

  const actions = el("div", "overlay-actions");
  const saveBtn = el("button", "btn btn-dismiss", "SAVE");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => {
    try {
      const timeVal = clock.hasTime() ? clock.getTime() : null;
      const dateVal = cal.getDate();
      await updatePlanItem({
        index: detailItem!.index,
        time: timeVal,
        dueDate: dateVal,
        category,
        important,
        title: titleInput.value.trim() || detailItem!.title,
        description: descInput.value.trim() || null,
      });
      detailItem = null;
      renderOverlay(true);
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  const toggleBtn = el("button", "btn btn-dismiss", detailItem.done ? "MARK PENDING" : "MARK DONE");
  toggleBtn.type = "button";
  toggleBtn.addEventListener("click", async () => {
    try {
      await togglePlanItem(detailItem!.index, !detailItem!.done);
      detailItem = null;
      renderOverlay(true);
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  const deferBtn = el("button", "btn btn-dismiss", "DEFER TOMORROW");
  deferBtn.type = "button";
  deferBtn.addEventListener("click", async () => {
    try {
      await deferPlanItem(detailItem!.index);
      detailItem = null;
      renderOverlay(true);
      showToast("Deferred to tomorrow");
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  const deleteBtn = el("button", "btn btn-deny", "DELETE");
  deleteBtn.type = "button";
  deleteBtn.addEventListener("click", async () => {
    try {
      await deletePlanItem(detailItem!.index);
      detailItem = null;
      renderOverlay(true);
      showToast("Task deleted");
    } catch (err) {
      showToast(String(err), "error");
    }
  });

  const focusBtn = el("button", "btn btn-approve", "FOCUS");
  focusBtn.type = "button";
  focusBtn.addEventListener("click", () => {
    focusItem = detailItem;
    detailItem = null;
    renderOverlay(true);
  });

  actions.append(saveBtn, toggleBtn, deferBtn, focusBtn, deleteBtn);
  card.appendChild(body);
  card.appendChild(actions);
  backdrop.appendChild(card);

  return backdrop;
}

function renderNotificationOverlay(): HTMLElement | null {
  if (!activeNotification) return null;

  const backdrop = el("div", "overlay-backdrop notification-backdrop");
  const card = el("div", "overlay-card notification-card");
  const queueCount = notificationQueue.length;
  const titleText =
    activeNotification.kind === "upcoming"
      ? `UPCOMING${queueCount > 1 ? ` (${queueCount})` : ""}`
      : `NOW${queueCount > 1 ? ` (${queueCount})` : ""}`;
  card.appendChild(el("div", "overlay-title", titleText));

  if (activeNotification.thumbUrl || activeNotification.imageUrl) {
    const img = document.createElement("img");
    img.className = "notification-thumb";
    img.src = activeNotification.thumbUrl ?? activeNotification.imageUrl!;
    img.alt = "";
    img.draggable = false;
    card.appendChild(img);
  }

  card.appendChild(el("div", "overlay-body", activeNotification.title));
  if (activeNotification.notes) card.appendChild(el("div", "overlay-meta", activeNotification.notes));

  const dismiss = el("button", "btn btn-dismiss", "DISMISS");
  dismiss.type = "button";
  dismiss.addEventListener("click", async () => {
    const id = activeNotification!.id;
    notificationQueue = notificationQueue.filter((n) => n.id !== id);
    activeNotification = null;
    await dismissNotification(id).catch(() => {});
    showNextNotification();
    renderOverlay(true);
  });

  const snooze = el("button", "btn btn-dismiss", "SNOOZE 5M");
  snooze.type = "button";
  snooze.addEventListener("click", async () => {
    const id = activeNotification!.id;
    notificationQueue = notificationQueue.filter((n) => n.id !== id);
    activeNotification = null;
    await snoozeNotification(id, 5).catch(() => {});
    showNextNotification();
    renderOverlay(true);
    showToast("Snoozed 5 minutes");
  });

  const actions = el("div", "overlay-actions");
  actions.append(snooze, dismiss);
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

function showNextNotification(): void {
  notificationQueue = notificationQueue.filter((n) => n.id !== activeNotification?.id);
  activeNotification = notificationQueue[0] ?? null;
}

function renderQuickCaptureOverlay(): HTMLElement | null {
  if (!captureOpen) return null;

  const backdrop = el("div", "overlay-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) {
      captureOpen = false;
      renderOverlay(true);
    }
  });

  const card = el("div", "overlay-card detail-card");
  card.appendChild(el("div", "overlay-title", "QUICK CAPTURE"));

  const body = el("div", "detail-card-body");
  body.appendChild(el("div", "picker-section-label", "TITLE"));
  const titleInput = document.createElement("input");
  titleInput.className = "detail-title-input";
  titleInput.placeholder = "What needs doing?";
  body.appendChild(titleInput);

  const tagRow = el("div", "detail-tag-row");
  let category: PlanCategory = "personal";
  const personalBtn = el("button", "filter-chip active", "PERSONAL");
  const workBtn = el("button", "filter-chip", "WORK");
  personalBtn.type = "button";
  workBtn.type = "button";
  personalBtn.addEventListener("click", () => {
    category = "personal";
    personalBtn.classList.add("active");
    workBtn.classList.remove("active");
  });
  workBtn.addEventListener("click", () => {
    category = "work";
    workBtn.classList.add("active");
    personalBtn.classList.remove("active");
  });
  tagRow.append(personalBtn, workBtn);
  body.appendChild(tagRow);
  card.appendChild(body);

  const actions = el("div", "overlay-actions");
  const addBtn = el("button", "btn btn-approve", "ADD");
  addBtn.type = "button";
  addBtn.addEventListener("click", async () => {
    const title = titleInput.value.trim();
    if (!title) {
      showToast("Enter a title", "error");
      return;
    }
    try {
      await createPlanItem({ title, category });
      captureOpen = false;
      renderOverlay(true);
      showToast("Task added");
    } catch (err) {
      showToast(String(err), "error");
    }
  });
  const cancelBtn = el("button", "btn btn-dismiss", "CANCEL");
  cancelBtn.type = "button";
  cancelBtn.addEventListener("click", () => {
    captureOpen = false;
    renderOverlay(true);
  });
  actions.append(addBtn, cancelBtn);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function renderFocusOverlay(): HTMLElement | null {
  if (!focusItem) return null;

  window.clearInterval(focusTimerId);

  const backdrop = el("div", "overlay-backdrop focus-backdrop");
  const card = el("div", "overlay-card focus-card");
  card.appendChild(el("div", "overlay-title", "FOCUS MODE"));
  card.appendChild(el("div", "focus-task-title", focusItem.title));
  if (focusItem.description) card.appendChild(el("div", "focus-task-desc", focusItem.description));
  if (focusItem.time) card.appendChild(el("div", "overlay-meta", focusItem.time));

  let secondsLeft = 25 * 60;
  const timerEl = el("div", "focus-timer", "25:00");
  card.appendChild(timerEl);
  const timerId = window.setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft <= 0) {
      window.clearInterval(timerId);
      timerEl.textContent = "Done!";
      return;
    }
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    timerEl.textContent = `${m}:${String(s).padStart(2, "0")}`;
  }, 1000);
  focusTimerId = timerId;

  const doneBtn = el("button", "btn btn-approve", "MARK DONE");
  doneBtn.type = "button";
  doneBtn.addEventListener("click", async () => {
    window.clearInterval(focusTimerId);
    try {
      await togglePlanItem(focusItem!.index, true);
      focusItem = null;
      renderOverlay(true);
    } catch (err) {
      showToast(String(err), "error");
    }
  });
  const exitBtn = el("button", "btn btn-dismiss", "EXIT FOCUS");
  exitBtn.type = "button";
  exitBtn.addEventListener("click", () => {
    window.clearInterval(focusTimerId);
    focusItem = null;
    renderOverlay(true);
  });
  const actions = el("div", "overlay-actions");
  actions.append(doneBtn, exitBtn);
  card.appendChild(actions);
  backdrop.appendChild(card);
  return backdrop;
}

function overlayKey(): string {
  if (focusItem) return `focus:${focusItem.index}`;
  if (captureOpen) return "capture";
  if (approval) return `approval:${approval.requestId}`;
  if (activeNotification) return `notif:${activeNotification.id}`;
  if (detailItem) return `detail:${detailItem.index}`;
  const activeCron = cronPrompts.find((p) => !p.dismissed && p.status !== "completed");
  if (activeCron) return `cron:${activeCron.jobId ?? activeCron.id}`;
  return "";
}

function buildOverlay(): HTMLElement | null {
  return (
    renderApprovalOverlay() ??
    renderNotificationOverlay() ??
    renderFocusOverlay() ??
    renderQuickCaptureOverlay() ??
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

function updateAgeLabels(): void {
  const now = Date.now();
  for (const age of mainRoot.querySelectorAll<HTMLElement>(".plan-age[data-added-at]")) {
    const addedAt = age.dataset.addedAt;
    if (addedAt) age.textContent = formatAgeMinutes(addedAt, now);
  }
}

function updateOfflineBanner(): void {
  if (!offlineBannerEl) return;
  offlineBannerEl.classList.toggle("visible", !apiOnline);
  offlineBannerEl.textContent = apiOnline ? "" : "OFFLINE — retrying connection…";
}

function updateNowNextStrip(): void {
  if (!nowNextEl || !dashboard) return;
  const pending = filterItems(dashboard.todolist.plan.pending);
  const next = findNextTimedItem(pending, todayYmd());
  if (!next) {
    nowNextEl.textContent = "No timed tasks ahead";
    nowNextEl.classList.add("empty");
    return;
  }
  nowNextEl.classList.remove("empty");
  nowNextEl.textContent = formatNowNextText(next);
}

function formatEventTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
}

function updateEventsRibbon(): void {
  if (!eventsRibbonEl || !dashboard) return;
  eventsRibbonEl.replaceChildren();
  const events = [...(dashboard.events ?? [])].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
  );
  if (events.length === 0) {
    eventsRibbonEl.appendChild(el("span", "events-empty", "No events today"));
    return;
  }
  for (const event of events.slice(0, 6)) {
    const chip = el("span", "event-chip", `${formatEventTime(event.startAt)} ${event.title}`);
    eventsRibbonEl.appendChild(chip);
  }
}

function updatePlanTabVisibility(): void {
  const useTabs = is7inLayout();
  if (pendingPanelEl) pendingPanelEl.classList.toggle("tab-hidden", useTabs && planTab !== "pending");
  if (donePanelEl) donePanelEl.classList.toggle("tab-hidden", useTabs && planTab !== "done");
  if (planTabPendingBtn) planTabPendingBtn.classList.toggle("active", planTab === "pending");
  if (planTabDoneBtn) planTabDoneBtn.classList.toggle("active", planTab === "done");
}

function updateInfoStrip(): void {
  const done = dashboard?.todolist.completed ?? 0;
  const pending = dashboard?.todolist.pending ?? 0;
  const cronCount = dashboard?.cron_jobs.filter((j) => j.enabled).length ?? 0;

  if (gatewayChipEl) {
    const online = apiOnline && gatewayOnline;
    gatewayChipEl.className = `info-chip ${online ? "online" : "offline"}`;
    const label = gatewayChipEl.lastChild;
    if (label) label.textContent = online ? "ONLINE" : "OFFLINE";
  }
  if (cronChipEl) cronChipEl.textContent = `CRON ${cronCount}`;
  if (runChipEl) runChipEl.textContent = `RUN ${dashboard?.tasks.running ?? 0}`;
  if (countChipEl) countChipEl.textContent = `${done}/${done + pending}`;

  const sys = dashboard?.system;
  if (sys) {
    if (cpuChipEl) cpuChipEl.textContent = `CPU ${sys.cpu}`;
    if (ramChipEl) ramChipEl.textContent = `RAM ${sys.ram}`;
    if (diskChipEl) diskChipEl.textContent = `DISK ${sys.disk}`;
  }

  if (infoStripDetailEl) {
    infoStripDetailEl.classList.toggle("expanded", infoStripExpanded);
  }
  updateNowNextStrip();
  updateEventsRibbon();
  updateOfflineBanner();
}

function updatePanelHeaders(): void {
  const pendingCount = filterItems(dashboard?.todolist.plan.pending ?? []).length;
  const doneCount = filterItems(dashboard?.todolist.plan.done ?? []).length;
  if (pendingHeaderEl) pendingHeaderEl.textContent = `TODAY'S PLAN (${pendingCount})`;
  if (doneHeaderEl) doneHeaderEl.textContent = `DONE TODAY (${doneCount})`;
  if (planTabPendingBtn) planTabPendingBtn.textContent = `PLAN (${pendingCount})`;
  if (planTabDoneBtn) planTabDoneBtn.textContent = `DONE (${doneCount})`;
}

function updatePlanPanels(): void {
  const key = planDataKey();
  if (key === lastPlanKey) {
    updateAgeLabels();
    return;
  }

  const scrollTops = preservePanelScroll();
  lastPlanKey = key;

  if (pendingBodyEl) {
    pendingBodyEl.replaceChildren();
    pendingBodyEl.appendChild(renderPlanItems(dashboard?.todolist.plan.pending ?? [], false, pendingBodyEl));
  }
  if (doneBodyEl) {
    doneBodyEl.replaceChildren();
    doneBodyEl.appendChild(renderPlanItems(dashboard?.todolist.plan.done ?? [], true, doneBodyEl));
  }

  restorePanelScroll(scrollTops);
  updatePanelHeaders();
  updateAgeLabels();
  updateInfoStrip();
  updatePlanTabVisibility();
}

function renderFilterBar(): HTMLElement {
  const bar = el("div", "filter-bar");
  for (const f of ["all", "personal", "work"] as const) {
    const btn = el("button", `filter-chip${planFilter === f ? " active" : ""}`, f === "all" ? "ALL" : f.toUpperCase());
    btn.type = "button";
    btn.addEventListener("click", () => {
      planFilter = f;
      lastPlanKey = "";
      for (const chip of bar.querySelectorAll(".filter-chip")) chip.classList.remove("active");
      btn.classList.add("active");
      updatePlanPanels();
    });
    bar.appendChild(btn);
  }
  return bar;
}

function renderInfoStrip(): HTMLElement {
  const strip = el("div", "info-strip");
  strip.addEventListener("click", () => {
    infoStripExpanded = !infoStripExpanded;
    updateInfoStrip();
  });

  gatewayChipEl = el("span", `info-chip ${gatewayOnline ? "online" : "offline"}`);
  gatewayChipEl.appendChild(el("span", "dot"));
  gatewayChipEl.appendChild(document.createTextNode(gatewayOnline ? "ONLINE" : "OFFLINE"));
  strip.appendChild(gatewayChipEl);

  const done = dashboard?.todolist.completed ?? 0;
  const pending = dashboard?.todolist.pending ?? 0;
  countChipEl = el("span", "info-chip", `${done}/${done + pending}`);
  strip.appendChild(countChipEl);

  const sys = dashboard?.system;
  if (sys) {
    cpuChipEl = el("span", "info-chip", `CPU ${sys.cpu}`);
    strip.appendChild(cpuChipEl);
  }

  infoStripDetailEl = el("div", "info-strip-detail");
  const cronCount = dashboard?.cron_jobs.filter((j) => j.enabled).length ?? 0;
  cronChipEl = el("span", "info-chip", `CRON ${cronCount}`);
  runChipEl = el("span", "info-chip", `RUN ${dashboard?.tasks.running ?? 0}`);
  infoStripDetailEl.append(cronChipEl, runChipEl);
  if (sys) {
    ramChipEl = el("span", "info-chip", `RAM ${sys.ram}`);
    diskChipEl = el("span", "info-chip", `DISK ${sys.disk}`);
    infoStripDetailEl.append(ramChipEl, diskChipEl);
  }
  strip.appendChild(infoStripDetailEl);

  infoStripEl = strip;
  return strip;
}

function buildMainShell(): void {
  mainRoot.replaceChildren();

  offlineBannerEl = el("div", "offline-banner");
  mainRoot.appendChild(offlineBannerEl);

  const topBar = el("header", "top-bar");
  const closeBtn = el("button", "close-btn", "✕");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", () => void exitApp());
  topBar.appendChild(closeBtn);

  const center = el("div", "header-center");
  const greeting = el("div", "greeting", getGreeting());
  greeting.id = "greeting";
  center.appendChild(greeting);
  const dateLine = el("div", "date-line", formatDate());
  dateLine.id = "date-line";
  center.appendChild(dateLine);
  topBar.appendChild(center);

  const clock = el("div", "clock", formatClock());
  clock.id = "clock";
  topBar.appendChild(clock);

  mainRoot.appendChild(topBar);

  nowNextEl = el("div", "now-next-strip empty", "No timed tasks ahead");
  mainRoot.appendChild(nowNextEl);

  mainRoot.appendChild(renderInfoStrip());

  eventsRibbonEl = el("div", "events-ribbon");
  mainRoot.appendChild(eventsRibbonEl);

  mainRoot.appendChild(renderFilterBar());

  const tabBar = el("div", "plan-tab-bar");
  planTabPendingBtn = el("button", "plan-tab active", "PLAN");
  planTabDoneBtn = el("button", "plan-tab", "DONE");
  planTabPendingBtn.type = "button";
  planTabDoneBtn.type = "button";
  planTabPendingBtn.addEventListener("click", () => {
    planTab = "pending";
    updatePlanTabVisibility();
    updatePanelHeaders();
  });
  planTabDoneBtn.addEventListener("click", () => {
    planTab = "done";
    updatePlanTabVisibility();
    updatePanelHeaders();
  });
  tabBar.append(planTabPendingBtn, planTabDoneBtn);
  mainRoot.appendChild(tabBar);

  const grid = el("main", "main-grid");

  const pendingPanel = el("section", "panel");
  pendingPanelEl = pendingPanel;
  pendingHeaderEl = el("div", "panel-header", "TODAY'S PLAN");
  pendingPanel.appendChild(pendingHeaderEl);
  pendingBodyEl = el("div", "panel-body");
  pendingBodyEl.dataset.scrollId = "pending";
  attachPanelScrollGuard(pendingBodyEl);
  pendingPanel.appendChild(pendingBodyEl);
  grid.appendChild(pendingPanel);

  const donePanel = el("section", "panel panel-done");
  donePanelEl = donePanel;
  doneHeaderEl = el("div", "panel-header", "DONE TODAY");
  donePanel.appendChild(doneHeaderEl);
  doneBodyEl = el("div", "panel-body");
  doneBodyEl.dataset.scrollId = "done";
  attachPanelScrollGuard(doneBodyEl);
  donePanel.appendChild(doneBodyEl);
  grid.appendChild(donePanel);

  mainRoot.appendChild(grid);

  fabEl = el("button", "fab-add", "+");
  fabEl.type = "button";
  fabEl.setAttribute("aria-label", "Add task");
  fabEl.addEventListener("click", () => {
    captureOpen = true;
    renderOverlay(true);
  });
  app.appendChild(fabEl);

  mainShellBuilt = true;
  updatePlanTabVisibility();
}

function renderMain(): void {
  if (!mainShellBuilt) {
    buildMainShell();
    refreshHeaderTime();
  }
  updatePlanPanels();
}

function applyDashboardData(data: DashboardData): void {
  dashboard = data;
  gatewayOnline = data.gateway.online;

  if (detailItem) {
    detailItem = findPlanItem(data, detailItem.index) ?? detailItem;
  }

  if (!activeNotification && data.pending_notifications.length > 0) {
    notificationQueue = [...data.pending_notifications];
    activeNotification = notificationQueue[0]!;
    renderOverlay(true);
  } else if (data.pending_notifications.length > notificationQueue.length) {
    for (const n of data.pending_notifications) {
      if (!notificationQueue.some((q) => q.id === n.id)) notificationQueue.push(n);
    }
  }

  renderMain();
  updateInfoStrip();
  if (detailItem) return;
  renderOverlay();
}

function bootstrap(): void {
  ensureFullscreen();
  initLayoutDetection(() => {
    updatePlanTabVisibility();
    updatePanelHeaders();
  });
  setupGateway();
  setupClock();
  applyNightDesk();

  startLiveDashboard(
    (data) => applyDashboardData(data),
    (notification) => {
      if (!notificationQueue.some((n) => n.id === notification.id)) {
        notificationQueue.unshift(notification);
      }
      if (!activeNotification) activeNotification = notification;
      renderOverlay(true);
    },
    5000,
    (online) => {
      apiOnline = online;
      updateOfflineBanner();
      updateInfoStrip();
    },
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

function refreshHeaderTime(now = new Date()): void {
  const clock = document.getElementById("clock");
  if (clock) clock.textContent = formatClock(now);

  const greeting = document.getElementById("greeting");
  if (greeting) greeting.textContent = getGreeting(now);

  const dateLine = document.getElementById("date-line");
  if (dateLine) dateLine.textContent = formatDate(now);

  updateNowNextStrip();
  applyNightDesk(now);
}

function applyNightDesk(now = new Date()): void {
  document.documentElement.classList.toggle("night-desk", isNightDeskHour(now));
}

function setupClock(): void {
  refreshHeaderTime();

  setInterval(() => {
    refreshHeaderTime();
  }, 1000);

  setInterval(() => {
    updateAgeLabels();
  }, 60_000);
}

void bootstrap();
