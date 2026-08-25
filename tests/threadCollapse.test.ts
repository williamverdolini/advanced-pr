import { describe, expect, it } from "vitest";
import { collapsedThreadIds, withoutCollapseOverride } from "../src/core/threadCollapse";

const threads = [
  { id: 1, isOpen: true },
  { id: 2, isOpen: false },
];

describe("which threads start folded", () => {
  it("folds a resolved thread and leaves an open one alone", () => {
    expect([...collapsedThreadIds(threads, new Map())]).toEqual([2]);
  });

  it("lets the reader reopen a resolved thread", () => {
    expect([...collapsedThreadIds(threads, new Map([[2, false]]))]).toEqual([]);
  });

  it("lets the reader fold an open thread", () => {
    expect([...collapsedThreadIds(threads, new Map([[1, true]]))]).toEqual([1, 2]);
  });

  it("keeps a choice that agrees with the default", () => {
    expect([...collapsedThreadIds(threads, new Map([[2, true]]))]).toEqual([2]);
  });

  it("ignores an override for a thread that is not there", () => {
    expect([...collapsedThreadIds(threads, new Map([[99, true]]))]).toEqual([2]);
  });

  it("has nothing to fold without threads", () => {
    expect([...collapsedThreadIds([], new Map([[1, true]]))]).toEqual([]);
  });
});

// Resolving is the scenario these describe: the reader presses Resolve (or
// Reply & resolve) on a thread they had unfolded to read, and it has to fold
// itself. What the card does is drop its own decision; the default does the
// rest, which is why folding after a resolve needs no rule of its own.
describe("resolving a thread the reader had unfolded", () => {
  const openThread = { id: 1, isOpen: true };
  const resolvedThread = { id: 1, isOpen: false };

  it("folds it, once the thread comes back resolved", () => {
    // Unfolded by hand while it was open, so an override says "expanded".
    const overrides = new Map([[1, false]]);
    expect([...collapsedThreadIds([openThread], overrides)]).toEqual([]);

    const afterResolve = withoutCollapseOverride(overrides, 1);
    expect([...collapsedThreadIds([resolvedThread], afterResolve)]).toEqual([1]);
  });

  it("unfolds it again when it is reopened", () => {
    // Folded by hand while it was resolved, so an override says "collapsed".
    const overrides = new Map([[1, true]]);
    expect([...collapsedThreadIds([resolvedThread], overrides)]).toEqual([1]);

    const afterReopen = withoutCollapseOverride(overrides, 1);
    expect([...collapsedThreadIds([openThread], afterReopen)]).toEqual([]);
  });

  it("folds a thread that was never touched, which is the common case", () => {
    const afterResolve = withoutCollapseOverride(new Map(), 1);
    expect([...collapsedThreadIds([resolvedThread], afterResolve)]).toEqual([1]);
  });

  it("leaves every other thread's decision alone", () => {
    const overrides = new Map([
      [1, false],
      [2, false],
    ]);
    const afterResolve = withoutCollapseOverride(overrides, 1);
    expect(afterResolve.get(2)).toBe(false);
    expect(afterResolve.has(1)).toBe(false);
  });

  it("keeps the same map when there was nothing to drop", () => {
    // Replaced, not mutated, and only when there is a change to make.
    const overrides = new Map([[2, true]]);
    expect(withoutCollapseOverride(overrides, 1)).toBe(overrides);
  });
});
