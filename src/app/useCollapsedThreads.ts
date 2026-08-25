import * as React from "react";
import { withoutCollapseOverride } from "../core/threadCollapse";

const noOverrides: ReadonlyMap<number, boolean> = new Map();

export interface CollapsedThreads {
  /**
   * What the reader has decided, per thread, against the default in
   * `core/threadCollapse`. A thread that is absent has not been decided on.
   */
  overrides: ReadonlyMap<number, boolean>;
  setCollapsed: (threadId: number, collapsed: boolean) => void;
  /** The glyph in the margin is the only way back for a collapsed thread. */
  toggle: (threadId: number, collapsed: boolean) => void;
  /**
   * Forgets every decision, so the next file starts from the defaults. Unfolding
   * a resolved thread means "let me read this one", not "keep every resolved
   * thread open from now on": without this, one such click in a session would
   * stop resolved threads being born folded for the rest of it.
   */
  reset: () => void;
  /**
   * Drops one thread's decision, for when the thread itself changed under it:
   * see `withoutCollapseOverride`.
   */
  clearOverride: (threadId: number) => void;
}

/** Which inline threads the reviewer has folded away, or unfolded. */
export function useCollapsedThreads(): CollapsedThreads {
  const [overrides, setOverrides] = React.useState(noOverrides);

  const setCollapsed = React.useCallback((threadId: number, collapsed: boolean): void => {
    // Replaced, not mutated: React compares by reference.
    setOverrides((current) => new Map(current).set(threadId, collapsed));
  }, []);

  const toggle = React.useCallback(
    // The current state is passed in rather than read here: it is not this
    // map that holds it, since a thread with no override still has a default.
    (threadId: number, collapsed: boolean): void => setCollapsed(threadId, !collapsed),
    [setCollapsed],
  );

  const reset = React.useCallback((): void => setOverrides(noOverrides), []);

  const clearOverride = React.useCallback((threadId: number): void => {
    setOverrides((current) => withoutCollapseOverride(current, threadId));
  }, []);

  return { overrides, setCollapsed, toggle, reset, clearOverride };
}
