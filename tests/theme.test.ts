import { describe, expect, it } from "vitest";
import { isDarkColor, parseCssColor } from "../src/core/theme";

describe("host theme detection", () => {
  it("parses the colour formats Azure DevOps exposes", () => {
    expect(parseCssColor("#1e1e1e")).toEqual([30, 30, 30]);
    expect(parseCssColor("#FFF")).toEqual([255, 255, 255]);
    expect(parseCssColor("rgb(31, 31, 31)")).toEqual([31, 31, 31]);
    expect(parseCssColor("rgba(246, 246, 246, 1)")).toEqual([246, 246, 246]);
    expect(parseCssColor(" 246, 246, 246 ")).toEqual([246, 246, 246]);
  });

  it("returns undefined for values it cannot read", () => {
    expect(parseCssColor("")).toBeUndefined();
    expect(parseCssColor("transparent")).toBeUndefined();
    expect(parseCssColor("#12345")).toBeUndefined();
  });

  it("classifies host backgrounds", () => {
    expect(isDarkColor("#1e1e1e")).toBe(true);
    expect(isDarkColor("rgba(31, 31, 31, 1)")).toBe(true);
    expect(isDarkColor("#ffffff")).toBe(false);
    expect(isDarkColor("rgba(246, 246, 246, 1)")).toBe(false);
  });

  it("falls back to the light theme when the colour is unreadable", () => {
    expect(isDarkColor("inherit")).toBe(false);
  });
});
