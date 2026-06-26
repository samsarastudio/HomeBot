let toastRoot: HTMLElement | null = null;
let hideTimer = 0;

function ensureToastRoot(): HTMLElement {
  if (!toastRoot) {
    toastRoot = document.createElement("div");
    toastRoot.className = "toast-root";
    document.body.appendChild(toastRoot);
  }
  return toastRoot;
}

export function showToast(message: string, kind: "error" | "info" = "info", ms = 3500): void {
  const root = ensureToastRoot();
  window.clearTimeout(hideTimer);
  root.replaceChildren();
  const toast = document.createElement("div");
  toast.className = `toast toast-${kind}`;
  toast.textContent = message;
  root.appendChild(toast);
  hideTimer = window.setTimeout(() => {
    root.replaceChildren();
  }, ms);
}
