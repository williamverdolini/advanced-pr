/**
 * Width of the files pane, in pixels. Wide enough that a file inside a couple
 * of folders is read without the tree truncating it.
 */
export const defaultSplitterWidth = 400;

export const minSplitterWidth = 180;

export const maxSplitterWidth = 720;

/**
 * A stored width outlives the bounds it was written under: it survives a change
 * to the limits below, a hand-edited entry, and a value left by another tool on
 * the same origin. Anything unusable falls back to the default; anything merely
 * out of range is clamped, so what is read back is what will be shown.
 */
export function readSplitterWidth(stored: string | null | undefined): number {
  const width = Number(stored);
  if (!stored || !Number.isFinite(width)) {
    return defaultSplitterWidth;
  }

  return Math.min(Math.max(Math.round(width), minSplitterWidth), maxSplitterWidth);
}
