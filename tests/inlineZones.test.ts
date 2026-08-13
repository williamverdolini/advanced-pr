import { describe, expect, it } from "vitest";
import { buildInlineZones, type InlineZoneThread } from "../src/core/inlineZones";

const anchored = (id: number, startLine: number, isOpen = true): InlineZoneThread => ({
  id,
  isOpen,
  position: { side: "right", startLine },
});

describe("inline zones", () => {
  it("mounts one zone per anchored thread, ordered by line", () => {
    const { zones, hiddenThreadCount } = buildInlineZones({
      filePath: "src/a.ts",
      threads: [anchored(3, 20), anchored(2, 4)],
    });

    expect(hiddenThreadCount).toBe(0);
    expect(zones.map((zone) => zone.key)).toEqual([
      "src/a.ts::thread-2",
      "src/a.ts::thread-3",
    ]);
    expect(zones.map((zone) => zone.afterLineNumber)).toEqual([4, 20]);
  });

  it("keys zones by file so switching file replaces every zone", () => {
    const first = buildInlineZones({ filePath: "src/a.ts", threads: [anchored(1, 2)] });
    const second = buildInlineZones({ filePath: "src/b.ts", threads: [anchored(1, 2)] });

    expect(first.zones[0].key).not.toBe(second.zones[0].key);
  });

  it("collects threads without an anchor into a single zone above the file", () => {
    const { zones } = buildInlineZones({
      filePath: "src/a.ts",
      threads: [anchored(1, 5), { id: 7, isOpen: true }, { id: 8, isOpen: false }],
    });

    expect(zones[0]).toMatchObject({
      key: "src/a.ts::orphans",
      kind: "orphans",
      side: "right",
      afterLineNumber: 0,
      threadIds: [7, 8],
    });
  });

  it("omits the orphan zone when every thread is anchored", () => {
    const { zones } = buildInlineZones({ filePath: "src/a.ts", threads: [anchored(1, 5)] });

    expect(zones.some((zone) => zone.kind === "orphans")).toBe(false);
  });

  it("moves threads anchored to a hidden side above the file", () => {
    const threads: InlineZoneThread[] = [
      { id: 5, isOpen: true, position: { side: "left", startLine: 9 } },
      anchored(6, 11),
    ];

    const inline = buildInlineZones({ filePath: "src/a.ts", threads });
    expect(inline.zones.map((zone) => [zone.kind, zone.threadIds])).toEqual([
      ["orphans", [5]],
      ["thread", [6]],
    ]);

    const split = buildInlineZones({
      filePath: "src/a.ts",
      threads,
      visibleSides: ["left", "right"],
    });
    expect(split.zones.map((zone) => [zone.kind, zone.side, zone.afterLineNumber])).toEqual([
      ["thread", "left", 9],
      ["thread", "right", 11],
    ]);
  });

  it("anchors to the base side when only that side is shown, as for a deleted file", () => {
    const threads: InlineZoneThread[] = [
      { id: 5, isOpen: true, position: { side: "left", startLine: 9 } },
      anchored(6, 11),
    ];

    const { zones } = buildInlineZones({
      filePath: "src/gone.ts",
      threads,
      visibleSides: ["left"],
    });

    expect(zones.map((zone) => [zone.kind, zone.side, zone.threadIds])).toEqual([
      ["orphans", "left", [6]],
      ["thread", "left", [5]],
    ]);
  });

  it("mounts no zone for a collapsed thread", () => {
    const threads = [anchored(1, 5), anchored(2, 9), { id: 7, isOpen: true }];

    const { zones } = buildInlineZones({
      filePath: "src/a.ts",
      threads,
      collapsedThreadIds: new Set([2, 7]),
    });

    expect(zones.map((zone) => zone.key)).toEqual(["src/a.ts::thread-1"]);
  });

  it("places the draft zone at the end of the selected range", () => {
    const { zones } = buildInlineZones({
      filePath: "src/a.ts",
      threads: [],
      draft: { side: "left", line: 12 },
    });

    expect(zones).toEqual([
      {
        key: "src/a.ts::draft",
        kind: "draft",
        side: "left",
        afterLineNumber: 12,
        threadIds: [],
      },
    ]);
  });

  it("caps the thread zones, keeping the selected and open ones", () => {
    const threads = [
      anchored(1, 1, false),
      anchored(2, 2, false),
      anchored(3, 3, true),
      anchored(4, 4, false),
    ];
    const { zones, hiddenThreadCount } = buildInlineZones({
      filePath: "src/a.ts",
      threads,
      selectedThreadId: 4,
      maxThreadZones: 2,
    });

    expect(hiddenThreadCount).toBe(2);
    expect(zones.map((zone) => zone.threadIds[0])).toEqual([3, 4]);
  });
});
