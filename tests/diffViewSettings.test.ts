import { describe, expect, it } from "vitest";
import {
  defaultDiffViewSettings,
  readDiffViewSettings,
  writeDiffViewSettings,
} from "../src/core/diffViewSettings";

describe("stored diff view settings", () => {
  it("reads back what it wrote", () => {
    const settings = { showWhitespace: true, wordWrap: true, stickyScroll: false };
    expect(readDiffViewSettings(writeDiffViewSettings(settings))).toEqual(settings);
  });

  it("falls back to the defaults when nothing is stored", () => {
    expect(readDiffViewSettings(null)).toEqual(defaultDiffViewSettings);
    expect(readDiffViewSettings(undefined)).toEqual(defaultDiffViewSettings);
    expect(readDiffViewSettings("")).toEqual(defaultDiffViewSettings);
  });

  it("keeps the settings it recognises when one is missing or unusable", () => {
    // What an older build wrote, before the third setting existed.
    expect(readDiffViewSettings('{"showWhitespace":true,"wordWrap":true}')).toEqual({
      showWhitespace: true,
      wordWrap: true,
      stickyScroll: defaultDiffViewSettings.stickyScroll,
    });
    expect(readDiffViewSettings('{"wordWrap":"yes","stickyScroll":false}')).toEqual({
      showWhitespace: false,
      wordWrap: false,
      stickyScroll: false,
    });
  });

  it("survives a value left by something else on the origin", () => {
    expect(readDiffViewSettings("not json")).toEqual(defaultDiffViewSettings);
    expect(readDiffViewSettings("null")).toEqual(defaultDiffViewSettings);
    expect(readDiffViewSettings("[1,2]")).toEqual(defaultDiffViewSettings);
    expect(readDiffViewSettings("42")).toEqual(defaultDiffViewSettings);
  });
});
