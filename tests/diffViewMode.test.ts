import { describe, expect, it } from "vitest";
import { availableDiffViewModes, resolveDiffViewMode } from "../src/core/diffViewMode";

describe("available diff view modes", () => {
  it("offers both layouts for a file with two sides on a wide screen", () => {
    expect(
      availableDiffViewModes({ path: "src/app/App.tsx", contentOnly: false, narrow: false }),
    ).toEqual(["inline", "sideBySide"]);
  });

  it("drops side by side where only one column fits", () => {
    expect(
      availableDiffViewModes({ path: "src/app/App.tsx", contentOnly: false, narrow: true }),
    ).toEqual(["inline"]);
  });

  it("drops side by side for a file that exists on one side only", () => {
    expect(
      availableDiffViewModes({ path: "src/app/App.tsx", contentOnly: true, narrow: false }),
    ).toEqual(["inline"]);
  });

  it("offers the preview for Markdown, whatever the width", () => {
    expect(
      availableDiffViewModes({ path: "docs/README.md", contentOnly: false, narrow: false }),
    ).toEqual(["inline", "sideBySide", "preview"]);
    expect(
      availableDiffViewModes({ path: "docs/README.MD", contentOnly: true, narrow: true }),
    ).toEqual(["inline", "preview"]);
  });
});

describe("resolving the requested mode", () => {
  it("keeps a request the file can honour", () => {
    expect(resolveDiffViewMode("preview", ["inline", "preview"])).toBe("preview");
  });

  it("falls back to inline when the request does not apply", () => {
    expect(resolveDiffViewMode("preview", ["inline", "sideBySide"])).toBe("inline");
    expect(resolveDiffViewMode("sideBySide", ["inline"])).toBe("inline");
  });
});
