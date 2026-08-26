import { describe, expect, it } from "vitest";
import { formatLedgerEvent } from "../src/core/ledger";
import { formatMarker, isGeneratedComment, readMarkerPayload } from "../src/core/marker";

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

describe("the marker envelope", () => {
  const payload = { kind: "step-approved", eventId: "e-1", planId: "p-1" };

  it("writes a link reference definition, which renders as nothing", () => {
    // The form matters, not just the content: an HTML comment is hidden by the
    // web interface but printed in full by the notification mail.
    expect(formatMarker(payload)).toBe(
      '[//]: # (advanced-pr:v3 {"kind":"step-approved","eventId":"e-1","planId":"p-1"})',
    );
  });

  it("reads back what it wrote", () => {
    expect(JSON.parse(readMarkerPayload(formatMarker(payload)) ?? "")).toEqual(payload);
  });

  it("still reads the v2 comments already in every pull request", () => {
    const v2 = '<!-- advanced-pr:v2 {"kind":"review-plan","planId":"plan-1","version":3} -->';
    expect(JSON.parse(readMarkerPayload(v2) ?? "")).toEqual({
      kind: "review-plan",
      planId: "plan-1",
      version: 3,
    });
    expect(isGeneratedComment(v2)).toBe(true);
  });

  it("survives a parenthesis in the payload, which would end the marker early", () => {
    const risky = { kind: "step-approved", stepId: "step (one) of two" };
    const marker = formatMarker(risky);

    expect(marker).toContain(String.raw`\(`);
    expect(JSON.parse(readMarkerPayload(marker) ?? "")).toEqual(risky);
  });

  it("finds the marker under the text of the comment", () => {
    const comment = `Step approved: Grid and card\n\n${formatMarker(payload)}`;
    expect(JSON.parse(readMarkerPayload(comment) ?? "")).toEqual(payload);
    expect(isGeneratedComment(comment)).toBe(true);
  });

  it("reads nothing out of a comment a person wrote", () => {
    expect(readMarkerPayload("Looks good to me")).toBeUndefined();
    expect(readMarkerPayload("[//]: # (a plain markdown comment)")).toBeUndefined();
    expect(isGeneratedComment("[//]: # (a plain markdown comment)")).toBe(false);
  });
});
