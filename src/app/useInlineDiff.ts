import * as React from "react";
import type {
  DiffRevealTarget,
  DiffSelection,
  DiffThreadDecoration,
} from "../components/DiffViewer";
import {
  buildInlineZones,
  type DiffSide,
  type InlineZoneDescriptor,
} from "../core/inlineZones";
import type { ReviewThread } from "../platform/azureDevOpsClient";

export interface InlineDiffInput {
  filePath?: string;
  /** The threads on the open file, in the order the tree lists them. */
  threads: readonly ReviewThread[];
  draft?: DiffSelection;
  selectedThreadId?: number;
  collapsedThreadIds: ReadonlySet<number>;
  contentOnly: boolean;
  contentSide: DiffSide;
  splitView: boolean;
}

export interface InlineDiff {
  zones: readonly InlineZoneDescriptor[];
  hiddenThreadCount: number;
  threadDecorations: readonly DiffThreadDecoration[];
  revealTarget?: DiffRevealTarget;
}

/**
 * Everything the diff editor needs in order to show comments inside the code:
 * where to open a view zone, which lines to mark in the margin, and where to
 * scroll. All memoized, because a new identity here rebuilds zones and
 * decorations in Monaco rather than merely re-rendering.
 */
export function useInlineDiff({
  filePath,
  threads,
  draft,
  selectedThreadId,
  collapsedThreadIds,
  contentOnly,
  contentSide,
  splitView,
}: InlineDiffInput): InlineDiff {
  // A file that exists on one side only has just the one side on screen; a
  // unified diff renders the modified side alone.
  const visibleSides = React.useMemo<readonly DiffSide[]>(
    () => (contentOnly ? [contentSide] : splitView ? ["left", "right"] : ["right"]),
    [contentOnly, contentSide, splitView],
  );

  const threadDecorations = React.useMemo(
    () =>
      threads
        .filter((thread) => thread.position)
        // The base editor is not rendered inline, so its glyphs would be lost.
        .filter((thread) => visibleSides.includes(thread.position!.side))
        .map((thread) => ({
          id: thread.id,
          side: thread.position!.side,
          line: thread.position!.startLine,
          isOpen: thread.isOpen,
        })),
    [threads, visibleSides],
  );

  const layout = React.useMemo(
    () =>
      buildInlineZones({
        filePath: filePath ?? "",
        threads,
        draft: draft ? { side: draft.side, line: draft.endLine } : undefined,
        selectedThreadId,
        visibleSides,
        collapsedThreadIds,
      }),
    [collapsedThreadIds, draft, filePath, selectedThreadId, threads, visibleSides],
  );

  const selectedThreadPosition = threads.find(
    (thread) => thread.id === selectedThreadId,
  )?.position;
  // Only a new selection may scroll the diff; a refresh must leave it alone,
  // which is why the position itself is deliberately not a dependency.
  const revealTarget = React.useMemo(
    () =>
      selectedThreadPosition && visibleSides.includes(selectedThreadPosition.side)
        ? { side: selectedThreadPosition.side, line: selectedThreadPosition.startLine }
        : undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedThreadId, visibleSides],
  );

  return {
    zones: layout.zones,
    hiddenThreadCount: layout.hiddenThreadCount,
    threadDecorations,
    revealTarget,
  };
}
