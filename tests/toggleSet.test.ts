import { describe, expect, it } from "vitest";
import { toggleMember, withMember, withMembers } from "../src/core/toggleSet";

describe("toggle set", () => {
  it("adds and removes a member without mutating the original", () => {
    const set: ReadonlySet<number> = new Set([1, 2]);

    expect([...withMember(set, 3, true)]).toEqual([1, 2, 3]);
    expect([...withMember(set, 1, false)]).toEqual([2]);
    expect([...set]).toEqual([1, 2]);
  });

  it("returns the same set when the membership already matches", () => {
    const set: ReadonlySet<number> = new Set([1, 2]);

    expect(withMember(set, 1, true)).toBe(set);
    expect(withMember(set, 9, false)).toBe(set);
  });

  it("toggles in both directions", () => {
    const set: ReadonlySet<string> = new Set(["src"]);

    expect([...toggleMember(set, "src")]).toEqual([]);
    expect([...toggleMember(set, "tests")]).toEqual(["src", "tests"]);
  });

  it("applies a bulk change only to the values that differ", () => {
    const set: ReadonlySet<string> = new Set(["a", "b"]);

    expect([...withMembers(set, ["b", "c"], true)]).toEqual(["a", "b", "c"]);
    expect([...withMembers(set, ["a", "z"], false)]).toEqual(["b"]);
    expect(withMembers(set, ["a", "b"], true)).toBe(set);
    expect(withMembers(set, [], false)).toBe(set);
  });
});
