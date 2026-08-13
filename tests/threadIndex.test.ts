import { describe, expect, it } from "vitest";
import { indexThreadsByFile } from "../src/core/threadIndex";

describe("thread index", () => {
  it("groups code threads by file and sorts them by anchor line", () => {
    const index = indexThreadsByFile([
      { id: 3, filePath: "src/a.ts", position: { startLine: 20 } },
      { id: 1 },
      { id: 2, filePath: "src/a.ts", position: { startLine: 4 } },
      { id: 4, filePath: "src/b.ts", position: { startLine: 1 } },
    ]);

    expect(index.get("src/a.ts")?.map((thread) => thread.id)).toEqual([2, 3]);
    expect(index.get("src/b.ts")?.map((thread) => thread.id)).toEqual([4]);
    expect(index.size).toBe(2);
  });
});