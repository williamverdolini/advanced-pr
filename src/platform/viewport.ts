/**
 * How wide the review has to be before the file tree can sit beside the diff.
 * Below it the two do not fit: a 300px pane out of 400 leaves a strip of code.
 */
const narrowQuery = "(max-width: 860px)";

/**
 * Touch, pen, or anything else without a hover state. Distinct from the width:
 * a tablet with a mouse wants the roomy layout but not the hover affordances,
 * and a narrow desktop window wants the opposite.
 */
const coarsePointerQuery = "(pointer: coarse)";

export interface Viewport {
  /** The file tree cannot share the width with the diff. */
  narrow: boolean;
  /** No hover to rely on: anything only reachable by hovering is unreachable. */
  coarsePointer: boolean;
}

export function readViewport(): Viewport {
  return {
    narrow: matchMedia(narrowQuery).matches,
    coarsePointer: matchMedia(coarsePointerQuery).matches,
  };
}

/**
 * Calls `onChange` immediately and again whenever either answer changes.
 * Returns a dispose function, like `observeHostTheme`.
 */
export function observeViewport(onChange: (viewport: Viewport) => void): () => void {
  const queries = [matchMedia(narrowQuery), matchMedia(coarsePointerQuery)];
  const notify = (): void => onChange(readViewport());
  notify();

  // `addEventListener` rather than the deprecated `addListener`, which older
  // Safari needed: the host runs a current browser engine in every case.
  queries.forEach((query) => query.addEventListener("change", notify));
  return () => queries.forEach((query) => query.removeEventListener("change", notify));
}
