import { describe, expect, it } from "vitest";
import {
  defaultSplitterWidth,
  maxSplitterWidth,
  minSplitterWidth,
  readSplitterWidth,
} from "../src/core/splitterWidth";

describe("splitter width", () => {
  it("falls back to the default when nothing was stored", () => {
    expect(readSplitterWidth(null)).toBe(defaultSplitterWidth);
    expect(readSplitterWidth(undefined)).toBe(defaultSplitterWidth);
    expect(readSplitterWidth("")).toBe(defaultSplitterWidth);
  });

  it("falls back to the default rather than trusting an unreadable value", () => {
    expect(readSplitterWidth("wide")).toBe(defaultSplitterWidth);
    expect(readSplitterWidth("320px")).toBe(defaultSplitterWidth);
    expect(readSplitterWidth("NaN")).toBe(defaultSplitterWidth);
  });

  it("returns a stored width inside the limits", () => {
    expect(readSplitterWidth("320")).toBe(320);
    expect(readSplitterWidth("320.6")).toBe(321);
  });

  it("clamps a width the current limits no longer allow", () => {
    expect(readSplitterWidth("40")).toBe(minSplitterWidth);
    expect(readSplitterWidth("2000")).toBe(maxSplitterWidth);
    expect(readSplitterWidth("-100")).toBe(minSplitterWidth);
  });
});
