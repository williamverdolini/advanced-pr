export type DiffSide = "left" | "right";

export interface InlineZoneThread {
  id: number;
  isOpen: boolean;
  position?: {
    side: DiffSide;
    startLine: number;
  };
}

export interface InlineZoneAnchor {
  side: DiffSide;
  line: number;
}

export type InlineZoneKind = "thread" | "orphans" | "draft";

export interface InlineZoneDescriptor {
  key: string;
  kind: InlineZoneKind;
  side: DiffSide;
  /** 0 mounts the zone above the first line of the file. */
  afterLineNumber: number;
  threadIds: readonly number[];
}

export interface InlineZoneLayout {
  zones: readonly InlineZoneDescriptor[];
  /** Threads dropped by the cap: surfaced to the user, never silently hidden. */
  hiddenThreadCount: number;
}

export interface InlineZoneInput {
  filePath: string;
  threads: readonly InlineZoneThread[];
  draft?: InlineZoneAnchor;
  selectedThreadId?: number;
  maxThreadZones?: number;
  /**
   * Threads the reviewer collapsed from the glyph margin: no zone is mounted
   * for them, and the glyph is what brings them back.
   */
  collapsedThreadIds?: ReadonlySet<number>;
  /**
   * Sides the viewer actually renders. A thread anchored to a side that is not
   * on screen (the base version in a unified diff, or either side of a file
   * shown as plain content) has no line to sit under and falls back to the
   * zone above the file. Defaults to the changed side only.
   */
  visibleSides?: readonly DiffSide[];
}

/**
 * A file with hundreds of comments would mean hundreds of view zones, each with
 * its own observer and React subtree. Beyond this many, the least relevant
 * threads stay reachable from the tree instead.
 */
export const defaultMaxThreadZones = 60;

/**
 * Describes every inline region a file needs, keyed so that a thread keeps its
 * view zone, and the React state inside it, across refreshes.
 */
export function buildInlineZones({
  filePath,
  threads,
  draft,
  selectedThreadId,
  maxThreadZones = defaultMaxThreadZones,
  visibleSides = ["right"],
  collapsedThreadIds,
}: InlineZoneInput): InlineZoneLayout {
  const isAnchorable = (thread: InlineZoneThread): boolean =>
    Boolean(thread.position) && visibleSides.includes(thread.position!.side);
  const expanded = collapsedThreadIds
    ? threads.filter((thread) => !collapsedThreadIds.has(thread.id))
    : threads;
  // Folding an anchored thread is safe: its glyph stays in the margin, and that
  // glyph is how it comes back. A thread with no line on a rendered side has no
  // glyph to come back from, so it keeps its place in the orphans zone whether
  // it is folded or not — the caller draws a folded one as a single row.
  const anchored = expanded.filter(isAnchorable);
  const unanchored = threads.filter((thread) => !isAnchorable(thread));
  const kept = capThreads(anchored, selectedThreadId, maxThreadZones);
  const zones: InlineZoneDescriptor[] = [];

  if (unanchored.length > 0) {
    zones.push({
      key: `${filePath}::orphans`,
      kind: "orphans",
      side: visibleSides[0] ?? "right",
      afterLineNumber: 0,
      threadIds: unanchored.map((thread) => thread.id),
    });
  }

  for (const thread of kept) {
    zones.push({
      key: `${filePath}::thread-${thread.id}`,
      kind: "thread",
      side: thread.position!.side,
      afterLineNumber: Math.max(0, thread.position!.startLine),
      threadIds: [thread.id],
    });
  }

  if (draft) {
    zones.push({
      key: `${filePath}::draft`,
      kind: "draft",
      side: draft.side,
      afterLineNumber: Math.max(0, draft.line),
      threadIds: [],
    });
  }

  return { zones, hiddenThreadCount: anchored.length - kept.length };
}

function capThreads(
  anchored: readonly InlineZoneThread[],
  selectedThreadId: number | undefined,
  maxThreadZones: number,
): readonly InlineZoneThread[] {
  const byLine = [...anchored].sort(
    (left, right) =>
      left.position!.startLine - right.position!.startLine || left.id - right.id,
  );
  if (byLine.length <= maxThreadZones) {
    return byLine;
  }

  const priority = [...byLine].sort((left, right) => {
    const selectionOrder =
      Number(right.id === selectedThreadId) - Number(left.id === selectedThreadId);
    return selectionOrder || Number(right.isOpen) - Number(left.isOpen);
  });
  const keptIds = new Set(priority.slice(0, maxThreadZones).map((thread) => thread.id));

  return byLine.filter((thread) => keptIds.has(thread.id));
}
