import { describe, expect, it } from "vitest";
import { computeBlockFoldingRanges } from "../src/core/blockFolding";

const csharpMarkers = { start: /^\s*#region\b/, end: /^\s*#endregion\b/ };

function ranges(source: string, options = {}): { start: number; end: number }[] {
  return computeBlockFoldingRanges(source.split("\n"), options).map(({ start, end }) => ({
    start,
    end,
  }));
}

describe("block folding ranges", () => {
  it("starts a block on the line above a brace of its own", () => {
    // 1 foreach, 2 {, 3 body, 4 }
    const source = ["foreach (var scope in scopes)", "{", "    Handle(scope);", "}"].join("\n");
    expect(ranges(source)).toEqual([{ start: 1, end: 3 }]);
  });

  it("leaves a brace that shares its line alone", () => {
    const source = ["foreach (var scope in scopes) {", "    Handle(scope);", "}"].join("\n");
    expect(ranges(source)).toEqual([{ start: 1, end: 2 }]);
  });

  it("nests a loop inside the method that declares it", () => {
    const source = [
      "public void Import()", // 1
      "{", // 2
      "    foreach (var scope in scopes)", // 3
      "    {", // 4
      "        Handle(scope);", // 5
      "    }", // 6
      "}", // 7
    ].join("\n");
    expect(ranges(source)).toEqual([
      { start: 1, end: 6 },
      { start: 3, end: 5 },
    ]);
  });

  it("walks past a wrapped signature to its first line", () => {
    const source = [
      "public async Task<Result> Import(", // 1
      "    string path,", // 2
      "    CancellationToken token)", // 3
      "{", // 4
      "    return null;", // 5
      "}", // 6
    ].join("\n");
    expect(ranges(source)).toContainEqual({ start: 1, end: 5 });
  });

  it("keeps a bare scope block on its brace", () => {
    // Nothing above it introduces it: the statement before is complete.
    const source = ["Prepare();", "{", "    var scoped = 1;", "}"].join("\n");
    expect(ranges(source)).toEqual([{ start: 2, end: 3 }]);
  });

  it("does not read a closing brace as a header", () => {
    const source = [
      "if (first)", // 1
      "{", // 2
      "    A();", // 3
      "}", // 4
      "{", // 5  a scope block, not an `else`
      "    B();", // 6
      "}", // 7
    ].join("\n");
    expect(ranges(source)).toEqual([
      { start: 1, end: 3 },
      { start: 5, end: 6 },
    ]);
  });

  it("skips a comment between the header and its brace", () => {
    const source = [
      "public void Import()", // 1
      "// why this exists", // 2
      "{", // 3
      "    Handle();", // 4
      "}", // 5
    ].join("\n");
    expect(ranges(source)).toEqual([{ start: 1, end: 4 }]);
  });

  it("keeps region markers, and does not move them", () => {
    const source = [
      "#region Imports", // 1
      "using System;", // 2
      "#endregion", // 3
    ].join("\n");
    expect(ranges(source, { markers: csharpMarkers })).toEqual([{ start: 1, end: 3 }]);
  });

  it("reads tabs as indentation", () => {
    const source = ["\tforeach (var scope in scopes)", "\t{", "\t\tHandle(scope);", "\t}"].join(
      "\n",
    );
    expect(ranges(source)).toEqual([{ start: 1, end: 3 }]);
  });

  it("produces nothing for a block with no body to fold", () => {
    expect(ranges(["void Empty()", "{", "}"].join("\n"))).toEqual([]);
  });
});
