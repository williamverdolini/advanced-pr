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
 * highlighted. The side still has to match, because a selection in the base
 * version says nothing about a click in the changed one.
 */
export function anchorForComment(
  line: CommentAnchor,
  selection: CommentAnchor | undefined,
): CommentAnchor {
  return selection && selection.side === line.side ? selection : line;
}
