import { describe, expect, it } from "vitest";
import { anchorForComment, type CommentAnchor } from "../src/core/commentAnchor";

const line = (startLine: number, side: "left" | "right" = "right"): CommentAnchor => ({
  side,
  startLine,
  startOffset: 1,
  endLine: startLine,
  endOffset: 20,
});

const range: CommentAnchor = {
  side: "right",
  startLine: 10,
  startOffset: 3,
  endLine: 15,
  endOffset: 8,
};

describe("comment anchor", () => {
  it("uses the clicked line when nothing is selected", () => {
    expect(anchorForComment(line(42), undefined)).toEqual(line(42));
  });

  it("prefers a live selection when the click lands inside it", () => {
    expect(anchorForComment(line(12), range)).toEqual(range);
    // Its own first and last lines count: the margin affordance is pinned to
    // the last line of a selection, so that is where the click usually is.
    expect(anchorForComment(line(10), range)).toEqual(range);
    expect(anchorForComment(line(15), range)).toEqual(range);
  });

  it("uses the clicked line when the selection is somewhere else", () => {
    // The case that filed a comment on line 30 after a click on line 1: a
    // selection left further up the file is not part of the gesture.
    expect(anchorForComment(line(1), range)).toEqual(line(1));
    expect(anchorForComment(line(42), range)).toEqual(line(42));
    expect(anchorForComment(line(9), range)).toEqual(line(9));
    expect(anchorForComment(line(16), range)).toEqual(line(16));
  });

  it("ignores a selection made on the other side of the diff", () => {
    expect(anchorForComment(line(12, "left"), range)).toEqual(line(12, "left"));
  });
});
