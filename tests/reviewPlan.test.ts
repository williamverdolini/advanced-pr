import { describe, expect, it } from "vitest";
import { buildStepPlan, parsePlanMarker } from "../src/core/reviewPlan";

describe("review plan", () => {
  it("reads a v2 marker", () => {
    const marker = parsePlanMarker(
      '<!-- advanced-pr:v2 {"kind":"review-plan","planId":"plan-1","version":2} -->',
    );

    expect(marker).toEqual({ planId: "plan-1", version: 2 });
  });

  describe("explain blocks", () => {
    const marker = { planId: "plan-1", version: 1 };

    it("captures the notes and ends the block at the first file entry", () => {
      const content = [
        "1. Core",
        "### Explain",
        "Start from `engine.ts`.",
        "The rest follows from it.",
        "",
        "- src/core.ts",
        "",
        "2. Tests",
        "- tests/core.test.ts",
      ].join("\n");

      const plan = buildStepPlan(content, ["src/core.ts", "tests/core.test.ts"], marker);

      expect(plan.steps.map((step) => step.title)).toEqual(["Core", "Tests", "Everything else"]);
      expect(plan.steps[0].explanation).toBe(
        "Start from `engine.ts`.\nThe rest follows from it.",
      );
      expect(plan.steps[1].explanation).toBeUndefined();
      expect(plan.steps[0].files).toEqual(["src/core.ts"]);
    });

    it("does not turn the Explain heading into a step", () => {
      const plan = buildStepPlan("1. Core\n## explain:\nnote\n- src/core.ts", ["src/core.ts"], marker);

      expect(plan.steps.map((step) => step.title)).toEqual(["Core", "Everything else"]);
    });

    it("keeps indented bullets inside the explanation instead of reading them as files", () => {
      const content = [
        "1. Core",
        "### Explain",
        "Watch out for:",
        "  - the cache invalidation",
        "  - the retry path",
        "- src/core.ts",
      ].join("\n");

      const plan = buildStepPlan(content, ["src/core.ts"], marker);

      expect(plan.steps[0].files).toEqual(["src/core.ts"]);
      expect(plan.steps[0].explanation).toBe(
        "Watch out for:\n  - the cache invalidation\n  - the retry path",
      );
    });

    it("leaves the plan hash and the step fingerprint untouched", () => {
      const withoutNotes = buildStepPlan("1. Core\n- src/core.ts", ["src/core.ts"], marker);
      const withNotes = buildStepPlan(
        "1. Core\n### Explain\nSome context.\n- src/core.ts",
        ["src/core.ts"],
        marker,
      );
      const editedNotes = buildStepPlan(
        "1. Core\n### Explain\nRewritten context.\n- src/core.ts",
        ["src/core.ts"],
        marker,
      );

      expect(withNotes.planHash).toBe(withoutNotes.planHash);
      expect(editedNotes.planHash).toBe(withoutNotes.planHash);
      expect(editedNotes.steps[0].fingerprint).toBe(withoutNotes.steps[0].fingerprint);
      expect(editedNotes.steps[0].stepId).toBe(withoutNotes.steps[0].stepId);
    });
  });

  it("assigns listed files and creates the catch-all step", () => {
    const content = `
1. Core
- src/core.ts

2. Tests
- tests/core.test.ts
`;
    const plan = buildStepPlan(
      content,
      ["src/core.ts", "tests/core.test.ts", "README.md"],
      { planId: "plan-1", version: 1 },
    );

    expect(plan.steps.map((step) => [step.title, step.files])).toEqual([
      ["Core", ["src/core.ts"]],
      ["Tests", ["tests/core.test.ts"]],
      ["Everything else", ["README.md"]],
    ]);
  });

  it("normalizes Azure DevOps paths with a leading slash", () => {
    const plan = buildStepPlan("1. Core\n- src/core.ts", ["/src/core.ts", "/README.md"], {
      planId: "plan-1",
      version: 1,
    });

    expect(plan.steps[0].files).toEqual(["src/core.ts"]);
    expect(plan.steps.at(-1)?.files).toEqual(["README.md"]);
  });

  it("keeps the canonical hash stable across cosmetic changes", () => {
    const compact = buildStepPlan("1. Core\n- src/core.ts", ["src/core.ts"], {
      planId: "plan-1",
      version: 1,
    });
    const spaced = buildStepPlan("Notes\n\n## 1. Core\n\n* `src/core.ts`", ["src/core.ts"], {
      planId: "plan-1",
      version: 1,
    });

    expect(spaced.planHash).toBe(compact.planHash);
  });

  it("keeps the plan hash stable when a new catch-all file changes only its fingerprint", () => {
    const before = buildStepPlan("1. Core\n- src/core.ts", ["src/core.ts"], {
      planId: "plan-1",
      version: 1,
    });
    const after = buildStepPlan(
      "1. Core\n- src/core.ts",
      ["src/core.ts", "src/new.ts"],
      { planId: "plan-1", version: 1 },
    );

    expect(after.planHash).toBe(before.planHash);
    expect(after.steps.at(-1)?.fingerprint).not.toBe(before.steps.at(-1)?.fingerprint);
  });
});
