import { readSplitterWidth } from "../core/splitterWidth";

/**
 * A layout preference, not review state: it belongs to the browser rather than
 * to a pull request, so it stays in `localStorage` instead of the extension
 * data service. The key is namespaced because the extension's origin is the
 * Marketplace CDN, shared with every other extension published from it.
 */
const storageKey = "advanced-pr.files-pane-width";

export function loadSplitterWidth(): number {
  // The extension runs in a cross-origin iframe, where a browser that blocks
  // third-party storage throws on the first access rather than returning null.
  try {
    return readSplitterWidth(window.localStorage.getItem(storageKey));
  } catch {
    return readSplitterWidth(undefined);
  }
}

export function saveSplitterWidth(width: number): void {
  try {
    window.localStorage.setItem(storageKey, String(Math.round(width)));
  } catch {
    // Losing the preference is not worth interrupting a review over.
  }
}
