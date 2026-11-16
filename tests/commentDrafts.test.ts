import { describe, expect, it } from "vitest";
import {
  editDraftKey,
  mergeCommentDrafts,
  newThreadDraftKey,
  readCommentDrafts,
  replyDraftKey,
  withCommentDraft,
  writeCommentDrafts,
  type CommentDraftAnchor,
} from "../src/core/commentDrafts";

const anchor: CommentDraftAnchor = {
  side: "right",
  startLine: 3,
  startOffset: 1,
  endLine: 5,
  endOffset: 8,
};

describe("comment drafts", () => {
  it("keys each editor separately", () => {
    const keys = [
      newThreadDraftKey("/src/a.ts"),
      newThreadDraftKey("/src/b.ts"),
      replyDraftKey(7),
      editDraftKey(7, 1),
      editDraftKey(7, 2),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("adds, replaces and removes a draft without touching the others", () => {
    const reply = replyDraftKey(1);
    const added = withCommentDraft({}, reply, { text: "first" });
    const other = withCommentDraft(added, replyDraftKey(2), { text: "other" });
    const replaced = withCommentDraft(other, reply, { text: "second" });
    const removed = withCommentDraft(replaced, reply, undefined);

    expect(replaced[reply].text).toBe("second");
    expect(removed).toEqual({ [replyDraftKey(2)]: { text: "other" } });
    expect(other[reply].text).toBe("first");
  });

  it("returns the same object when nothing changed", () => {
    const key = newThreadDraftKey("/a");
    const drafts = withCommentDraft({}, key, { text: "x", anchor });

    expect(withCommentDraft(drafts, key, { text: "x", anchor: { ...anchor } })).toBe(drafts);
    expect(withCommentDraft(drafts, replyDraftKey(9), undefined)).toBe(drafts);
  });

  it("treats a moved anchor as a change", () => {
    const key = newThreadDraftKey("/a");
    const drafts = withCommentDraft({}, key, { text: "x", anchor });
    const moved = withCommentDraft(drafts, key, { text: "x", anchor: { ...anchor, endLine: 9 } });

    expect(moved).not.toBe(drafts);
    expect(moved[key].anchor?.endLine).toBe(9);
  });

  it("round-trips through storage, dropping drafts with nothing typed", () => {
    const drafts = {
      [newThreadDraftKey("/a")]: { text: "look here", anchor },
      [newThreadDraftKey("/b")]: { text: "  ", anchor },
      [replyDraftKey(4)]: { text: "agreed" },
    };

    expect(readCommentDrafts(writeCommentDrafts(drafts))).toEqual({
      [newThreadDraftKey("/a")]: { text: "look here", anchor },
      [replyDraftKey(4)]: { text: "agreed" },
    });
  });

  it("reads nothing from a missing or unreadable value", () => {
    expect(readCommentDrafts(null)).toEqual({});
    expect(readCommentDrafts(undefined)).toEqual({});
    expect(readCommentDrafts("not json")).toEqual({});
    expect(readCommentDrafts("[]")).toEqual({});
    expect(readCommentDrafts("42")).toEqual({});
  });

  it("drops a malformed entry and keeps the rest", () => {
    const stored = JSON.stringify({
      good: { text: "keep" },
      noText: { anchor },
      badAnchor: { text: "drop", anchor: { ...anchor, side: "up" } },
      negativeLine: { text: "drop", anchor: { ...anchor, startLine: -1 } },
      notAnObject: "text",
    });

    expect(readCommentDrafts(stored)).toEqual({ good: { text: "keep" } });
  });

  it("lets text typed before the stored drafts arrived win over them", () => {
    const stored = { a: { text: "old" }, b: { text: "kept" } };
    const current = { a: { text: "new" } };

    expect(mergeCommentDrafts(stored, current)).toEqual({
      a: { text: "new" },
      b: { text: "kept" },
    });
    expect(mergeCommentDrafts({}, current)).toBe(current);
  });
});
