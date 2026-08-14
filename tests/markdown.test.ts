import { describe, expect, it } from "vitest";
import {
  findMentionIds,
  parseInline,
  parseMarkdown,
  safeLinkHref,
} from "../src/core/markdown";

describe("comment markdown", () => {
  it("parses the inline syntax the editor toolbar produces", () => {
    expect(parseInline("Scrivo un **commento** e metto anche del `codice`")).toEqual([
      { kind: "text", value: "Scrivo un " },
      { kind: "strong", children: [{ kind: "text", value: "commento" }] },
      { kind: "text", value: " e metto anche del " },
      { kind: "code", value: "codice" },
    ]);
  });

  it("parses emphasis with both markers", () => {
    expect(parseInline("_a_ and *b*")).toEqual([
      { kind: "emphasis", children: [{ kind: "text", value: "a" }] },
      { kind: "text", value: " and " },
      { kind: "emphasis", children: [{ kind: "text", value: "b" }] },
    ]);
  });

  it("keeps code spans literal", () => {
    expect(parseInline("`**not bold**`")).toEqual([
      { kind: "code", value: "**not bold**" },
    ]);
  });

  it("parses links and rejects script schemes", () => {
    expect(parseInline("[docs](https://example.com)")).toEqual([
      { kind: "link", href: "https://example.com", children: [{ kind: "text", value: "docs" }] },
    ]);
    // What matters is that no link node is produced and no text is lost; how
    // the leftover splits into text nodes renders identically either way.
    const rejected = parseInline("[x](javascript:alert(1))");
    expect(rejected.some((node) => node.kind === "link")).toBe(false);
    expect(
      rejected.map((node) => (node.kind === "text" ? node.value : "")).join(""),
    ).toBe("[x](javascript:alert(1))");
    expect(safeLinkHref("JavaScript:alert(1)")).toBeUndefined();
    expect(safeLinkHref("mailto:a@b.c")).toBe("mailto:a@b.c");
  });

  // Real payload: "@<8BD95966-6F7D-4654-9097-300BFB3D7EE7> un commento", where
  // the id matches the comment author's `id` in lower case.
  describe("mentions", () => {
    const id = "8bd95966-6f7d-4654-9097-300bfb3d7ee7";

    it("parses the token and normalises the id to lower case", () => {
      expect(parseInline(`@<${id.toUpperCase()}> ciao`)).toEqual([
        { kind: "mention", id },
        { kind: "text", value: " ciao" },
      ]);
    });

    it("keeps surrounding text and other inline syntax intact", () => {
      expect(parseInline(`ok @<${id}> **grazie**`)).toEqual([
        { kind: "text", value: "ok " },
        { kind: "mention", id },
        { kind: "text", value: " " },
        { kind: "strong", children: [{ kind: "text", value: "grazie" }] },
      ]);
    });

    it("leaves a mention inside a code span literal", () => {
      expect(parseInline(`\`@<${id}>\``)).toEqual([{ kind: "code", value: `@<${id}>` }]);
    });

    it("ignores anything that is not a well formed id", () => {
      expect(parseInline("@<not-a-guid> and @someone")).toEqual([
        { kind: "text", value: "@<not-a-guid> and @someone" },
      ]);
    });

    it("collects the ids a comment mentions", () => {
      expect(findMentionIds(`@<${id.toUpperCase()}> and @<${id}> and @<nope>`)).toEqual([id, id]);
      expect(findMentionIds("no mentions here")).toEqual([]);
    });
  });

  it("parses block structure", () => {
    const blocks = parseMarkdown(
      ["# Title", "", "- one", "- two", "", "> quoted", "", "```ts", "const x = 1", "```"].join(
        "\n",
      ),
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "list",
      "quote",
      "codeBlock",
    ]);
    expect(blocks[3]).toEqual({ kind: "codeBlock", language: "ts", value: "const x = 1" });
  });

  it("keeps consecutive lines inside one paragraph", () => {
    const blocks = parseMarkdown("first\nsecond\n\nthird");

    expect(blocks).toHaveLength(2);
    expect(blocks[0].kind === "paragraph" && blocks[0].lines).toHaveLength(2);
  });

  it("does not lose text when a fence is never closed", () => {
    const blocks = parseMarkdown("```\nstill code");

    expect(blocks).toEqual([{ kind: "codeBlock", language: undefined, value: "still code" }]);
  });
});
