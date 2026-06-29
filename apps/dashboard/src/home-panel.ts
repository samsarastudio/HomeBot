import type { HaArea, HaAreasResponse, HaEntity } from "@homebot/shared";
import { callHaService, fetchHaAreas, toggleHaArea } from "./home-api";
import { showToast } from "./toast";

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

function areaStateLabel(area: HaArea): string {
  const onCount = area.entities.filter((e) => e.on).length;
  if (onCount === 0) return "OFF";
  if (onCount === area.entities.length) return "ON";
  return "MIXED";
}

function syncEntityRow(row: HTMLElement, entity: HaEntity): void {
  row.classList.toggle("on", entity.on);
  const toggle = row.querySelector<HTMLButtonElement>(".ha-toggle");
  if (toggle) {
    toggle.classList.toggle("active", entity.on);
    toggle.textContent = entity.on ? "ON" : "OFF";
    toggle.setAttribute("aria-pressed", entity.on ? "true" : "false");
  }
}

function syncAreaHeader(header: HTMLElement, area: HaArea, forcedOn?: boolean): void {
  const onCount = area.entities.length > 0
    ? area.entities.filter((e) => e.on).length
    : forcedOn === true
      ? area.entities.length
      : forcedOn === false
        ? 0
        : 0;
  const allOn = area.entities.length > 0
    ? onCount === area.entities.length
    : forcedOn === true;
  const badge = header.querySelector<HTMLElement>(".ha-area-state");
  if (badge) {
    if (area.entities.length === 0 && forcedOn !== undefined) {
      badge.textContent = forcedOn ? "ON" : "OFF";
      badge.classList.toggle("active", forcedOn);
      badge.classList.toggle("mixed", false);
    } else {
      badge.textContent = areaStateLabel(area);
      badge.classList.toggle("active", allOn);
      badge.classList.toggle("mixed", onCount > 0 && !allOn);
    }
  }
  header.classList.toggle("on", allOn || forcedOn === true);
}

function renderEntityRow(
  entity: HaEntity,
  area: HaArea,
  header: HTMLElement,
): HTMLElement {
  const row = el("div", `ha-entity-row${entity.on ? " on" : ""}`);
  const label = el("span", "ha-entity-name", entity.name);
  const toggle = el("button", `ha-toggle${entity.on ? " active" : ""}`, entity.on ? "ON" : "OFF");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", entity.on ? "true" : "false");
  toggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    toggle.disabled = true;
    try {
      await callHaService(entity.entity_id, "toggle");
      entity.on = !entity.on;
      entity.state = entity.on ? "on" : "off";
      syncEntityRow(row, entity);
      syncAreaHeader(header, area);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      toggle.disabled = false;
    }
  });
  row.append(label, toggle);
  return row;
}

function renderArea(area: HaArea): HTMLElement {
  const section = el("section", "ha-area");
  const onCount = area.entities.filter((e) => e.on).length;
  const allOn = onCount === area.entities.length && area.entities.length > 0;

  const header = el("button", `ha-area-header${allOn ? " on" : ""}`);
  header.type = "button";
  header.appendChild(el("span", "ha-area-name", area.name));
  const badge = el("span", `ha-area-state${allOn ? " active" : onCount > 0 ? " mixed" : ""}`, areaStateLabel(area));
  header.appendChild(badge);

  const list = el("div", "ha-entity-list");
  const rows = new Map<string, HTMLElement>();
  for (const entity of area.entities) {
    const row = renderEntityRow(entity, area, header);
    rows.set(entity.entity_id, row);
    list.appendChild(row);
  }

  header.addEventListener("click", async () => {
    header.disabled = true;
    try {
      const clickAction =
        area.entities.length === 0
          ? header.dataset.areaOn === "true"
            ? "off"
            : "on"
          : "toggle";
      const result = await toggleHaArea(area.id, clickAction);
      const targetOn = result.action === "on";
      for (const entity of area.entities) {
        entity.on = targetOn;
        entity.state = targetOn ? "on" : "off";
        const row = rows.get(entity.entity_id);
        if (row) syncEntityRow(row, entity);
      }
      if (area.entities.length === 0) {
        header.dataset.areaOn = targetOn ? "true" : "false";
        syncAreaHeader(header, area, targetOn);
        showToast(targetOn ? `${area.name} on` : `${area.name} off`);
      } else {
        syncAreaHeader(header, area);
      }
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      header.disabled = false;
    }
  });

  section.append(header);
  if (area.entities.length > 0) section.appendChild(list);
  return section;
}

function renderHomeBody(data: HaAreasResponse, scroll: HTMLElement): void {
  scroll.replaceChildren();

  if (!data.configured) {
    scroll.appendChild(
      el(
        "p",
        "ha-status-msg",
        "Home Assistant not configured. Add a token at ~/.openclaw/secrets/ha-token",
      ),
    );
    return;
  }

  if (!data.reachable) {
    scroll.appendChild(
      el("p", "ha-status-msg", data.error ?? "Cannot reach Home Assistant"),
    );
    return;
  }

  if (data.areas.length === 0) {
    scroll.appendChild(
      el(
        "p",
        "ha-status-msg",
        "No areas or devices found. Assign devices to areas in Home Assistant, or add entity IDs to homeassistant-areas.json in your OpenClaw workspace.",
      ),
    );
    return;
  }

  for (const area of data.areas) {
    scroll.appendChild(renderArea(area));
  }
}

export function renderHomePanel(onClose: () => void): HTMLElement {
  const backdrop = el("div", "overlay-backdrop home-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) onClose();
  });

  const card = el("div", "overlay-card home-panel-card");
  const header = el("div", "home-panel-header");
  header.appendChild(el("div", "overlay-title", "HOME"));
  const closeBtn = el("button", "home-panel-close", "✕");
  closeBtn.type = "button";
  closeBtn.addEventListener("click", onClose);
  header.appendChild(closeBtn);
  card.appendChild(header);

  const scroll = el("div", "home-panel-scroll");
  scroll.appendChild(el("p", "ha-status-msg", "Loading…"));
  card.appendChild(scroll);

  const actions = el("div", "overlay-actions");
  const refreshBtn = el("button", "btn btn-dismiss", "REFRESH");
  refreshBtn.type = "button";
  refreshBtn.addEventListener("click", () => {
    void loadAreas(scroll, refreshBtn);
  });
  actions.appendChild(refreshBtn);
  card.appendChild(actions);

  backdrop.appendChild(card);
  void loadAreas(scroll, refreshBtn);
  return backdrop;
}

async function loadAreas(scroll: HTMLElement, refreshBtn: HTMLButtonElement): Promise<void> {
  refreshBtn.disabled = true;
  scroll.replaceChildren(el("p", "ha-status-msg", "Loading…"));
  try {
    const data = await fetchHaAreas();
    renderHomeBody(data, scroll);
  } catch (err) {
    scroll.replaceChildren(el("p", "ha-status-msg", String(err)));
  } finally {
    refreshBtn.disabled = false;
  }
}
