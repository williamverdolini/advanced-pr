import { describe, expect, it } from "vitest";
import { findMentionQuery, insertMention } from "../src/core/mentionQuery";

describe("mention typeahead query", () => {
  it("opens on @ at the start of a word", () => {
    expect(findMentionQuery("@wil", 4)).toEqual({ start: 0, query: "wil" });
    expect(findMentionQuery("ciao @wil", 9)).toEqual({ start: 5, query: "wil" });
    expect(findMentionQuery("(@wil", 5)).toEqual({ start: 1, query: "wil" });
  });

  it("opens with an empty query right after the @", () => {
    expect(findMentionQuery("ciao @", 6)).toEqual({ start: 5, query: "" });
  });

  it("does not open inside a word, so an email address is left alone", () => {
    expect(findMentionQuery("william.verdolini@teamnebula.it", 31)).toBeUndefined();
  });

  it("closes on a newline or on a query that starts with a space", () => {
    expect(findMentionQuery("@ wil", 5)).toBeUndefined();
    expect(findMentionQuery("@wil\nmore", 9)).toBeUndefined();
  });

  it("ignores an already completed mention", () => {
    expect(
      findMentionQuery("@<8BD95966-6F7D-4654-9097-300BFB3D7EE7> ok", 42),
    ).toBeUndefined();
  });

  it("reads the query only up to the caret", () => {
    expect(findMentionQuery("@william and more", 8)).toEqual({ start: 0, query: "william" });
  });

  it("replaces the query with the readable name and moves the caret past it", () => {
    const text = "ciao @wil, guarda";
    const mention = findMentionQuery(text, 9)!;

    expect(insertMention(text, mention, "William Verdolini")).toEqual({
      text: "ciao @William Verdolini , guarda",
      caret: 24,
    });
  });
});
