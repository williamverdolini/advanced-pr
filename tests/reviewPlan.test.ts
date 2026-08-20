import { describe, expect, it } from "vitest";
import {
  buildStepPlan,
  findStepForFile,
  parsePlanMarker,
} from "../src/core/reviewPlan";

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

  describe("related files", () => {
    const marker = { planId: "plan-1", version: 1 };

    it("reads a nested bullet as a file related to the entry above it", () => {
      const content = [
        "1. Sort contract",
        "### Explain",
        "Start from the extensions.",
        "",
        "- src/Search/SortConditions.cs",
        "  - src/SearchTest/SortConditionsTests.cs",
        "  - src/SearchTest/SortConditionsMultipleTests.cs",
        "- src/Search/OmniSearchRequest.cs",
      ].join("\n");

      const plan = buildStepPlan(
        content,
        [
          "src/Search/SortConditions.cs",
          "src/Search/OmniSearchRequest.cs",
          "src/SearchTest/SortConditionsTests.cs",
          "src/SearchTest/SortConditionsMultipleTests.cs",
        ],
        marker,
      );

      expect(plan.steps[0].files).toEqual([
        "src/Search/SortConditions.cs",
        "src/Search/OmniSearchRequest.cs",
      ]);
      expect(plan.steps[0].relatedFiles.get("src/Search/SortConditions.cs")).toEqual([
        "src/SearchTest/SortConditionsTests.cs",
        "src/SearchTest/SortConditionsMultipleTests.cs",
      ]);
      expect(plan.steps[0].explanation).toBe("Start from the extensions.");
      expect(plan.warnings).toEqual([]);
    });

    it("leaves a related file in the catch-all, so the step count is unchanged", () => {
      const plan = buildStepPlan(
        "1. Core\n- src/core.ts\n  - tests/core.test.ts",
        ["src/core.ts", "tests/core.test.ts"],
        marker,
      );

      expect(plan.steps[0].files).toEqual(["src/core.ts"]);
      expect(plan.steps.at(-1)?.files).toEqual(["tests/core.test.ts"]);
    });

    it("keeps a related file that a later step claims for itself", () => {
      const plan = buildStepPlan(
        "1. Core\n- src/core.ts\n  - tests/core.test.ts\n\n2. Tests\n- tests/core.test.ts",
        ["src/core.ts", "tests/core.test.ts"],
        marker,
      );

      expect(plan.steps[0].relatedFiles.get("src/core.ts")).toEqual(["tests/core.test.ts"]);
      expect(plan.steps[1].files).toEqual(["tests/core.test.ts"]);
      expect(plan.steps.at(-1)?.files).toEqual([]);
    });

    it("relates the same file to more than one entry", () => {
      const plan = buildStepPlan(
        "1. Core\n- src/core.ts\n  - tests/core.test.ts\n- src/rules.ts\n  - tests/core.test.ts",
        ["src/core.ts", "src/rules.ts", "tests/core.test.ts"],
        marker,
      );

      expect(plan.steps[0].relatedFiles.get("src/core.ts")).toEqual(["tests/core.test.ts"]);
      expect(plan.steps[0].relatedFiles.get("src/rules.ts")).toEqual(["tests/core.test.ts"]);
    });

    it("warns about a related path that is not in the pull request", () => {
      const plan = buildStepPlan(
        "1. Core\n- src/core.ts\n  - tests/gone.test.ts",
        ["src/core.ts"],
        marker,
      );

      expect(plan.steps[0].relatedFiles.size).toBe(0);
      expect(plan.warnings).toEqual([
        {
          kind: "stale-entry",
          path: "tests/gone.test.ts",
          message:
            "'tests/gone.test.ts', listed under 'src/core.ts', is not part of the current pull request.",
        },
      ]);
    });

    it("drops a repeated entry and the parent listed under itself", () => {
      const plan = buildStepPlan(
        "1. Core\n- src/core.ts\n  - tests/core.test.ts\n  - `tests/core.test.ts`\n  - src/core.ts",
        ["src/core.ts", "tests/core.test.ts"],
        marker,
      );

      expect(plan.steps[0].relatedFiles.get("src/core.ts")).toEqual(["tests/core.test.ts"]);
      expect(plan.warnings).toEqual([]);
    });

    it("reads the whole list as entries when it is indented as a block", () => {
      const plan = buildStepPlan(
        "1. Core\n  - src/core.ts\n  - src/rules.ts",
        ["src/core.ts", "src/rules.ts"],
        marker,
      );

      expect(plan.steps[0].files).toEqual(["src/core.ts", "src/rules.ts"]);
      expect(plan.steps[0].relatedFiles.size).toBe(0);
    });

    it("leaves the plan hash and the step fingerprint untouched", () => {
      const without = buildStepPlan("1. Core\n- src/core.ts", ["src/core.ts", "tests/core.test.ts"], marker);
      const withRelated = buildStepPlan(
        "1. Core\n- src/core.ts\n  - tests/core.test.ts",
        ["src/core.ts", "tests/core.test.ts"],
        marker,
      );

      expect(withRelated.planHash).toBe(without.planHash);
      expect(withRelated.steps[0].fingerprint).toBe(without.steps[0].fingerprint);
      expect(withRelated.steps.at(-1)?.fingerprint).toBe(without.steps.at(-1)?.fingerprint);
    });
  });

  it("finds the step a file belongs to, including the catch-all", () => {
    const plan = buildStepPlan(
      "1. Core\n- src/core.ts",
      ["src/core.ts", "README.md"],
      { planId: "plan-1", version: 1 },
    );

    expect(findStepForFile(plan.steps, "src/core.ts")?.title).toBe("Core");
    expect(findStepForFile(plan.steps, "README.md")?.title).toBe("Everything else");
    // The host writes the path with a leading slash, as `/src/core.ts`.
    expect(findStepForFile(plan.steps, "/src/core.ts")?.title).toBe("Core");
    expect(findStepForFile(plan.steps, "src/missing.ts")).toBeUndefined();
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
