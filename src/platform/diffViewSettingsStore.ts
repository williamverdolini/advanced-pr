import {
  readDiffViewSettings,
  writeDiffViewSettings,
  type DiffViewSettings,
} from "../core/diffViewSettings";

/**
 * A reading preference, not review state: it belongs to the browser rather than
 * to a pull request, so it stays in `localStorage` like the files pane's width,
 * and holds for every pull request opened in this browser profile. The key is
 * namespaced because the extension's origin is the Marketplace CDN, shared with
 * every other extension published from it.
 */
const storageKey = "advanced-pr.diff-view-settings";

export function loadDiffViewSettings(): DiffViewSettings {
  // The extension runs in a cross-origin iframe, where a browser that blocks
  // third-party storage throws on the first access rather than returning null.
  try {
    return readDiffViewSettings(window.localStorage.getItem(storageKey));
  } catch {
    return readDiffViewSettings(undefined);
  }
}

export function saveDiffViewSettings(settings: DiffViewSettings): void {
  try {
    window.localStorage.setItem(storageKey, writeDiffViewSettings(settings));
  } catch {
    // Losing the preference is not worth interrupting a review over.
  }
}
