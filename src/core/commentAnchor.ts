export interface CommentAnchor {
  side: "left" | "right";
  startLine: number;
  startOffset: number;
  endLine: number;
  endOffset: number;
}

/**
 * What a comment opened from the margin attaches to.
 *
 * A live selection wins over the line that was clicked: selecting code and then
 * asking to comment is one gesture, and the reviewer means the range they
 * highlighted. Two things have to hold for that reading to be the right one.
 *
 * The side has to match, because a selection in the base version says nothing
 * about a click in the changed one.
 *
 * And the click has to land **within** the selection. A selection left further
 * up the file is not part of the gesture: it used to win from any distance, so
 * a reviewer who had highlighted something around line 30, scrolled up and
 * clicked the margin on line 1 got their comment filed on line 30 — the one
 * place they could not see they had asked for.
 */
export function anchorForComment(
  line: CommentAnchor,
  selection: CommentAnchor | undefined,
): CommentAnchor {
  if (!selection || selection.side !== line.side) {
    return line;
  }

  const withinSelection =
    line.startLine >= selection.startLine && line.startLine <= selection.endLine;
  return withinSelection ? selection : line;
}
