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

function areaStateLabel(area: HaArea): "OFF" | "ON" | "MIXED" {
  const onCount = area.entities.filter((e) => e.on).length;
  if (area.entities.length === 0) return "OFF";
  if (onCount === 0) return "OFF";
  if (onCount === area.entities.length) return "ON";
  return "MIXED";
}

function renderEntityRow(entity: HaEntity, scroll: HTMLElement): HTMLElement {
  const row = el("div", `ha-entity-row${entity.on ? " on" : ""}`);
  const label = el("span", "ha-entity-name", entity.name);
  const toggle = el("button", `ha-toggle${entity.on ? " active" : ""}`, entity.on ? "ON" : "OFF");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", entity.on ? "true" : "false");
  toggle.setAttribute("aria-label", `Toggle ${entity.name}`);
  toggle.addEventListener("click", async (e) => {
    e.stopPropagation();
    toggle.disabled = true;
    try {
      await callHaService(entity.entity_id, "toggle");
      const data = await fetchHaAreas();
      renderHomeBody(data, scroll);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      toggle.disabled = false;
    }
  });
  row.append(label, toggle);
  return row;
}

function renderArea(area: HaArea, scroll: HTMLElement): HTMLElement {
  const section = el("section", "ha-area");
  const state = areaStateLabel(area);
  const allOn = state === "ON";

  const header = el("button", `ha-area-header${allOn ? " on" : state === "MIXED" ? " mixed" : ""}`);
  header.type = "button";

  const titleWrap = el("div", "ha-area-title-wrap");
  titleWrap.appendChild(el("span", "ha-area-name", area.name));
  const countLabel =
    area.entities.length === 1 ? "1 device" : `${area.entities.length} devices`;
  titleWrap.appendChild(el("span", "ha-area-count", countLabel));
  header.appendChild(titleWrap);

  const badge = el(
    "span",
    `ha-area-state${allOn ? " active" : state === "MIXED" ? " mixed" : ""}`,
    state,
  );
  header.appendChild(badge);

  const list = el("div", "ha-entity-list");
  for (const entity of area.entities) {
    list.appendChild(renderEntityRow(entity, scroll));
  }

  header.addEventListener("click", async () => {
    header.disabled = true;
    try {
      await toggleHaArea(area.id, "toggle");
      const data = await fetchHaAreas();
      renderHomeBody(data, scroll);
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      header.disabled = false;
    }
  });

  section.append(header, list);
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
        "No controllable devices found. Assign lights and switches to areas in Home Assistant.",
      ),
    );
    return;
  }

  for (const area of data.areas) {
    scroll.appendChild(renderArea(area, scroll));
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
