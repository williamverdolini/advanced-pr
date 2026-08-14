import { describe, expect, it } from "vitest";
import { formatLedgerEvent } from "../src/core/ledger";
import { isGeneratedComment } from "../src/core/marker";

describe("generated comments", () => {
  it("recognises a recorded decision", () => {
    const content = formatLedgerEvent("✅ **Step approved: `Core`**", {
      eventId: "event-1",
      kind: "step-approved",
      planId: "plan-1",
      planVersion: 1,
      planHash: "hash-1",
      stepId: "step-1",
    });

    expect(isGeneratedComment(content)).toBe(true);
  });

  it("recognises a plan, including a superseded version", () => {
    const plan = [
      "1. Core",
      "- src/core/engine.ts",
      "",
      '<!-- advanced-pr:v2 {"kind":"review-plan","planId":"plan-1","version":3} -->',
    ].join("\n");

    expect(isGeneratedComment(plan)).toBe(true);
  });

  it("leaves a comment a person typed alone, marker-shaped prose included", () => {
    expect(isGeneratedComment("Why does step 2 come before step 3?")).toBe(false);
    expect(isGeneratedComment("")).toBe(false);
    expect(isGeneratedComment("<!-- a plain html comment -->")).toBe(false);
    expect(isGeneratedComment("We should bump advanced-pr:v2 to v3 one day")).toBe(false);
  });
});
