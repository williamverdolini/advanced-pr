import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, safeLinkHref } from "../src/core/markdown";

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
