import * as React from "react";
import type { DiffSelection } from "../components/DiffViewer";

export interface DiffSelectionState {
  /** Whether a selection exists, which is all the toolbar needs to know. */
  hasSelection: boolean;
  /** Wired to the editor: fires on every cursor move. */
  track: (selection: DiffSelection | undefined) => void;
  clear: () => void;
  /** The live range, read at the moment an action needs it. */
  current: () => DiffSelection | undefined;
  /**
   * What a click in the glyph margin should anchor a comment to: the line
   * clicked, unless it lands inside a live selection, in which case the selected
   * range is what gets anchored.
   */
  anchorFor: (line: DiffSelection) => DiffSelection;
}

/**
 * The cursor selection inside the diff. The range itself is kept out of state on
 * purpose: a cursor drag must not re-render the tree. Only whether a selection
 * exists is tracked, and that flips rarely.
 */
export function useDiffSelection(): DiffSelectionState {
  const selection = React.useRef<DiffSelection>();
  const [hasSelection, setHasSelection] = React.useState(false);

  const track = React.useCallback((value: DiffSelection | undefined): void => {
    selection.current = value;
    setHasSelection(Boolean(value));
  }, []);

  const clear = React.useCallback((): void => {
    selection.current = undefined;
  }, []);

  const current = React.useCallback((): DiffSelection | undefined => selection.current, []);

  const anchorFor = React.useCallback((line: DiffSelection): DiffSelection => {
    const live = selection.current;
    const withinSelection =
      live &&
      live.side === line.side &&
      line.startLine >= live.startLine &&
      line.startLine <= live.endLine;
    return withinSelection ? live : line;
  }, []);

  return { hasSelection, track, clear, current, anchorFor };
}
