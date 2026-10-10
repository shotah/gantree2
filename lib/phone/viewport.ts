/** iOS / PWA leftover offset after the keyboard dismisses. */
export function recoverViewport(win: {
  scrollTo?: (x: number, y: number) => void;
  visualViewport?: { height: number } | null;
} | null | undefined): void {
  if (!win?.visualViewport) {
    return;
  }
  win.scrollTo?.(0, 0);
}

/** Bind the shell to the visual viewport so compose stays on-screen. */
export function viewportShellHeight(height: number | null | undefined): string | undefined {
  if (height == null || !Number.isFinite(height) || height <= 0) {
    return undefined;
  }
  return `${height}px`;
}
