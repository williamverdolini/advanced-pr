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

  it("prefers a live selection, wherever the click landed", () => {
    expect(anchorForComment(line(12), range)).toEqual(range);
    expect(anchorForComment(line(42), range)).toEqual(range);
  });

  it("ignores a selection made on the other side of the diff", () => {
    expect(anchorForComment(line(12, "left"), range)).toEqual(line(12, "left"));
  });
});
