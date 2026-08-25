export interface CollapsibleThread {
  readonly id: number;
  readonly isOpen: boolean;
}

/**
 * Which threads are folded away in the diff.
 *
 * A resolved thread starts collapsed: it is settled, it costs a card of height
 * in the middle of the code all the same, and what is worth reading is what is
 * still open. An explicit choice — collapsing an open one, or reopening a
 * resolved one to read it — outlives that default, so the reader is never
 * folding the same thread twice.
 *
 * The overrides are keyed by thread rather than remembered as a flat set,
 * because "not overridden" and "explicitly expanded" have to be different
 * things: a set alone cannot say the second, and a resolved thread would fold
 * itself again the moment anything else changed.
 */
/**
 * Forgets what the reader decided about one thread, so its default applies
 * again. This is what resolving or reopening a thread does: both change the
 * very thing the default reads, so the choice made against the old state has
 * nothing left to say. A thread resolved from its card folds itself, and one
 * reopened comes back open, without either being a special case.
 */
export function withoutCollapseOverride(
  overrides: ReadonlyMap<number, boolean>,
  threadId: number,
): ReadonlyMap<number, boolean> {
  if (!overrides.has(threadId)) {
    return overrides;
  }

  const next = new Map(overrides);
  next.delete(threadId);
  return next;
}

export function collapsedThreadIds(
  threads: readonly CollapsibleThread[],
  overrides: ReadonlyMap<number, boolean>,
): ReadonlySet<number> {
  const collapsed = new Set<number>();

  for (const thread of threads) {
    if (overrides.get(thread.id) ?? !thread.isOpen) {
      collapsed.add(thread.id);
    }
  }

  return collapsed;
}
