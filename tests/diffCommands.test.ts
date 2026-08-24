import { describe, expect, it } from "vitest";
import { diffCommandSpecs, type DiffCommandId } from "../src/core/diffCommands";
import type { DiffViewMode } from "../src/core/diffViewMode";

function ids(viewMode: DiffViewMode, viewModes: readonly DiffViewMode[]): DiffCommandId[] {
  return diffCommandSpecs({ viewMode, viewModes }).map((spec) => spec.id);
}

describe("the commands on the diff card's header", () => {
  // The regression this guards: two commands were added in 0.9.0 and the
  // difference arrows, fourth in the row, were pushed into the `...` menu.
  it("carries the difference navigation whenever a diff is on screen", () => {
    expect(ids("inline", ["inline", "sideBySide"])).toContain("difference-navigation");
    expect(ids("sideBySide", ["inline", "sideBySide"])).toContain("difference-navigation");
    // A file that exists on one side only still steps through its content.
    expect(ids("inline", ["inline"])).toContain("difference-navigation");
  });

  it("keeps every command out of the overflow menu", () => {
    // An overflowed command is rebuilt from `text` and `onActivate`, which a
    // custom control does not have: it would render as a dead label.
    for (const mode of ["inline", "sideBySide", "preview"] as const) {
      const specs = diffCommandSpecs({ viewMode: mode, viewModes: ["inline", "preview"] });
      expect(specs.length).toBeGreaterThan(0);
      expect(specs.every((spec) => spec.important)).toBe(true);
    }
  });

  it("names every command, for the tooltip and the screen reader", () => {
    const specs = diffCommandSpecs({ viewMode: "inline", viewModes: ["inline", "sideBySide"] });
    expect(specs.every((spec) => spec.text.length > 0)).toBe(true);
  });

  it("orders them the way the header shows them", () => {
    expect(ids("inline", ["inline", "sideBySide", "preview"])).toEqual([
      "diff-view-mode",
      "diff-view-options",
      "viewed",
      "difference-navigation",
    ]);
  });

  it("drops the mode picker when the file has only one mode", () => {
    expect(ids("inline", ["inline"])).not.toContain("diff-view-mode");
  });

  it("drops what does not apply to rendered Markdown, keeping the viewed mark", () => {
    expect(ids("preview", ["inline", "preview"])).toEqual(["diff-view-mode", "viewed"]);
  });
});
