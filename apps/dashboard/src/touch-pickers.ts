const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

export interface ClockState {
  hour12: number;
  minute: number;
  ampm: "AM" | "PM";
}

export function parseClockTime(value?: string): ClockState {
  const fallback: ClockState = { hour12: 9, minute: 0, ampm: "AM" };
  if (!value?.trim()) return fallback;

  const normalized = value.trim().toUpperCase().replace(/\s+/g, " ");
  const m12 = normalized.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (m12) {
    let hour12 = Number(m12[1]);
    const minute = Number(m12[2]);
    const ampm = m12[3] as "AM" | "PM";
    if (hour12 < 1 || hour12 > 12 || minute > 59) return fallback;
    const nearMin = MINUTES.reduce((best, m) =>
      Math.abs(m - minute) < Math.abs(best - minute) ? m : best,
    );
    return { hour12, minute: nearMin, ampm };
  }

  const m24 = normalized.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    let hours = Number(m24[1]);
    const minute = Number(m24[2]);
    const ampm: "AM" | "PM" = hours >= 12 ? "PM" : "AM";
    let hour12 = hours % 12;
    if (hour12 === 0) hour12 = 12;
    const nearMin = MINUTES.reduce((best, m) =>
      Math.abs(m - minute) < Math.abs(best - minute) ? m : best,
    );
    return { hour12, minute: nearMin, ampm };
  }

  return fallback;
}

export function formatClockTime(state: ClockState): string {
  const mm = String(state.minute).padStart(2, "0");
  return `${state.hour12}:${mm} ${state.ampm}`;
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function stepper(
  label: string,
  values: (string | number)[],
  initial: string | number,
  onChange: (v: string) => void,
): HTMLElement {
  const wrap = el("div", "picker-stepper");
  wrap.appendChild(el("div", "picker-stepper-label", label));

  let idx = values.findIndex((v) => String(v) === String(initial));
  if (idx < 0) idx = 0;

  const display = el("div", "picker-stepper-value", String(values[idx]));
  const down = el("button", "picker-step-btn", "−");
  const up = el("button", "picker-step-btn", "+");
  down.type = "button";
  up.type = "button";

  const apply = () => {
    display.textContent = String(values[idx]);
    onChange(String(values[idx]));
  };

  down.addEventListener("click", () => {
    idx = (idx - 1 + values.length) % values.length;
    apply();
  });
  up.addEventListener("click", () => {
    idx = (idx + 1) % values.length;
    apply();
  });

  wrap.append(down, display, up);
  return wrap;
}

export function createTouchClockPicker(initial?: string): {
  element: HTMLElement;
  getTime: () => string;
  hasTime: () => boolean;
  clearTime: () => void;
} {
  let state = parseClockTime(initial);
  let enabled = Boolean(initial?.trim());
  const root = el("div", "touch-clock-picker");

  const row = el("div", "picker-clock-row");
  const hourStep = stepper("HOUR", HOURS, state.hour12, (v) => {
    state.hour12 = Number(v);
    enabled = true;
  });
  const minStep = stepper("MIN", MINUTES.map((m) => String(m).padStart(2, "0")), String(state.minute).padStart(2, "0"), (v) => {
    state.minute = Number(v);
    enabled = true;
  });

  const ampmWrap = el("div", "picker-ampm");
  const amBtn = el("button", "picker-ampm-btn", "AM");
  const pmBtn = el("button", "picker-ampm-btn", "PM");
  amBtn.type = "button";
  pmBtn.type = "button";

  const syncAmpm = () => {
    amBtn.classList.toggle("active", state.ampm === "AM");
    pmBtn.classList.toggle("active", state.ampm === "PM");
  };

  amBtn.addEventListener("click", () => {
    state.ampm = "AM";
    enabled = true;
    syncAmpm();
  });
  pmBtn.addEventListener("click", () => {
    state.ampm = "PM";
    enabled = true;
    syncAmpm();
  });
  ampmWrap.append(amBtn, pmBtn);
  syncAmpm();

  row.append(hourStep, el("div", "picker-colon", ":"), minStep, ampmWrap);
  root.appendChild(row);

  const clearBtn = el("button", "picker-clear-btn", "NO TIME");
  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => {
    enabled = false;
    root.classList.add("is-cleared");
  });
  root.appendChild(clearBtn);

  return {
    element: root,
    getTime: () => (enabled ? formatClockTime(state) : ""),
    hasTime: () => enabled,
    clearTime: () => {
      enabled = false;
      root.classList.add("is-cleared");
    },
  };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function createTouchCalendarPicker(initial?: string | null): {
  element: HTMLElement;
  getDate: () => string | null;
  clearDate: () => void;
} {
  let selected: string | null = initial?.trim() || null;
  let view = selected ? new Date(`${selected}T12:00:00`) : new Date();
  const root = el("div", "touch-calendar-picker");

  const header = el("div", "cal-header");
  const prev = el("button", "cal-nav-btn", "‹");
  const next = el("button", "cal-nav-btn", "›");
  const title = el("div", "cal-title", "");
  prev.type = "button";
  next.type = "button";
  header.append(prev, title, next);

  const grid = el("div", "cal-grid");
  root.append(header, grid);

  const clearBtn = el("button", "picker-clear-btn", "NO DATE");
  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => {
    selected = null;
    root.classList.add("is-cleared");
    render();
  });
  root.appendChild(clearBtn);

  const render = () => {
    title.textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    grid.replaceChildren();

    for (const label of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
      grid.appendChild(el("div", "cal-dow", label));
    }

    const year = view.getFullYear();
    const month = view.getMonth();
    const first = new Date(year, month, 1);
    const startPad = first.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startPad; i++) {
      grid.appendChild(el("div", "cal-day cal-day-empty"));
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = ymd(new Date(year, month, day));
      const btn = el("button", "cal-day", String(day));
      btn.type = "button";
      if (selected === dateStr) btn.classList.add("selected");
      btn.addEventListener("click", () => {
        selected = dateStr;
        root.classList.remove("is-cleared");
        render();
      });
      grid.appendChild(btn);
    }
  };

  prev.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    render();
  });
  next.addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    render();
  });

  render();

  return {
    element: root,
    getDate: () => selected,
    clearDate: () => {
      selected = null;
      root.classList.add("is-cleared");
      render();
    },
  };
}
