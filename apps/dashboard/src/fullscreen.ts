/** Request fullscreen when the browser allows it (fallback when not launched with --kiosk). */
export function ensureFullscreen(): void {
  const root = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };

  const request = () => {
    if (document.fullscreenElement) return;
    const fn =
      root.requestFullscreen?.bind(root) ??
      root.webkitRequestFullscreen?.bind(root);
    if (!fn) return;
    void Promise.resolve(fn()).catch(() => {});
  };

  request();

  // Browsers block autoplay fullscreen — first touch enters fullscreen in dev/windowed mode.
  const onInteract = () => {
    request();
    document.removeEventListener("pointerdown", onInteract);
  };
  document.addEventListener("pointerdown", onInteract, { passive: true });
}

export function isLikelyKioskMode(): boolean {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    window.outerHeight >= screen.height - 80
  );
}
