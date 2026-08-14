import { describe, expect, it } from "vitest";
import {
  canApprovePullRequest,
  formatLedgerEvent,
  hasOutstandingChanges,
  hasOutstandingChangesAfterApproval,
  parseLedgerEvent,
  reduceReviewEvents,
  summarizeStepApprovals,
  type ReviewEvent,
} from "../src/core/ledger";

const currentPlan = { planId: "plan-1", planVersion: 1, planHash: "hash-1" };

function event(overrides: Partial<ReviewEvent>): ReviewEvent {
  return {
    eventId: "event-1",
    kind: "step-approved",
    planId: "plan-1",
    planVersion: 1,
    planHash: "hash-1",
    reviewerId: "reviewer-1",
    stepId: "step-1",
    publishedDate: "2026-08-13T10:00:00Z",
    commentId: 1,
    ...overrides,
  };
}

describe("review ledger", () => {
  it("round-trips a machine marker without trusting reviewer identity from JSON", () => {
    const content = formatLedgerEvent("Step approved", {
      eventId: "event-1",
      kind: "step-approved",
      planId: "plan-1",
      planVersion: 1,
      planHash: "hash-1",
      stepId: "step-1",
    });

    const parsed = parseLedgerEvent(content, "actual-author", "2026-08-13T10:00:00Z", 42);

    expect(parsed?.reviewerId).toBe("actual-author");
    expect(parsed?.commentId).toBe(42);
  });

  it("deduplicates retries by event id", () => {
    const duplicate = event({});
    const state = reduceReviewEvents([duplicate, duplicate], currentPlan);

    expect(state.acceptedEventIds.size).toBe(1);
  });

  it("applies the last event for a reviewer and step", () => {
    const state = reduceReviewEvents(
      [
        event({ kind: "step-changes-requested" }),
        event({
          eventId: "event-2",
          kind: "step-approved",
          publishedDate: "2026-08-13T10:01:00Z",
          commentId: 2,
        }),
      ],
      currentPlan,
    );

    expect(state.stepStates.get("reviewer-1")?.get("step-1")).toBe("approved");
    expect(hasOutstandingChanges(state, "reviewer-1")).toBe(false);
  });

  it("keeps a global changes request while another step is approved", () => {
    const state = reduceReviewEvents(
      [
        event({ kind: "step-changes-requested" }),
        event({ eventId: "event-2", stepId: "step-2", commentId: 2 }),
      ],
      currentPlan,
    );

    expect(hasOutstandingChanges(state, "reviewer-1")).toBe(true);
  });

  it("clears waiting for author only after the last requested step is approved", () => {
    const state = reduceReviewEvents(
      [
        event({ kind: "step-changes-requested", stepId: "step-1" }),
        event({
          eventId: "event-2",
          kind: "step-changes-requested",
          stepId: "step-2",
          commentId: 2,
        }),
      ],
      currentPlan,
    );

    expect(hasOutstandingChangesAfterApproval(state, "reviewer-1", "step-1")).toBe(true);
    expect(hasOutstandingChangesAfterApproval(state, "reviewer-1", "step-2")).toBe(true);

    const oneRequested = reduceReviewEvents(
      [event({ kind: "step-changes-requested", stepId: "step-1" })],
      currentPlan,
    );
    expect(hasOutstandingChangesAfterApproval(oneRequested, "reviewer-1", "step-1")).toBe(false);
  });

  describe("pull request sign-off", () => {
    const steps = [
      { stepId: "step-1", requiresApproval: true },
      { stepId: "step-2", requiresApproval: true },
      { stepId: "step-3", requiresApproval: false },
    ];

    it("stays unavailable until every step that needs approval has it", () => {
      const partial = reduceReviewEvents([event({ stepId: "step-1" })], currentPlan);
      expect(canApprovePullRequest(partial, "reviewer-1", steps)).toBe(false);

      const complete = reduceReviewEvents(
        [
          event({ stepId: "step-1" }),
          event({ eventId: "event-2", stepId: "step-2", commentId: 2 }),
        ],
        currentPlan,
      );
      expect(canApprovePullRequest(complete, "reviewer-1", steps)).toBe(true);
    });

    it("ignores empty steps but requires at least one reviewable step", () => {
      const state = reduceReviewEvents([], currentPlan);
      expect(
        canApprovePullRequest(state, "reviewer-1", [
          { stepId: "step-3", requiresApproval: false },
        ]),
      ).toBe(false);
    });

    it("stays unavailable while the reviewer has requested changes anywhere", () => {
      const state = reduceReviewEvents(
        [
          event({ stepId: "step-1" }),
          event({
            eventId: "event-2",
            kind: "step-changes-requested",
            stepId: "step-2",
            commentId: 2,
          }),
        ],
        currentPlan,
      );

      expect(canApprovePullRequest(state, "reviewer-1", steps)).toBe(false);
    });

    it("reports progress so the UI can explain why sign-off is unavailable", () => {
      const state = reduceReviewEvents([event({ stepId: "step-1" })], currentPlan);

      expect(summarizeStepApprovals(state, "reviewer-1", steps)).toEqual({
        required: 2,
        approved: 1,
        changesRequested: 0,
      });
    });

    it("is decided per reviewer", () => {
      const state = reduceReviewEvents(
        [
          event({ stepId: "step-1" }),
          event({ eventId: "event-2", stepId: "step-2", commentId: 2 }),
        ],
        currentPlan,
      );

      expect(canApprovePullRequest(state, "reviewer-2", steps)).toBe(false);
    });
  });

  describe("who decided on a step", () => {
    it("lists every reviewer with the decision that still stands", () => {
      const state = reduceReviewEvents(
        [
          event({ kind: "step-changes-requested" }),
          event({
            eventId: "event-2",
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 2,
          }),
          event({
            eventId: "event-3",
            reviewerId: "reviewer-2",
            kind: "step-changes-requested",
            publishedDate: "2026-08-13T12:00:00Z",
            commentId: 3,
          }),
        ],
        currentPlan,
      );

      expect([...(state.stepDecisions.get("step-1")?.values() ?? [])]).toEqual([
        {
          reviewerId: "reviewer-1",
          status: "approved",
          publishedDate: "2026-08-13T11:00:00Z",
        },
        {
          reviewerId: "reviewer-2",
          status: "changes-requested",
          publishedDate: "2026-08-13T12:00:00Z",
        },
      ]);
    });

    it("drops a reviewer who reset their decision, and keeps the others", () => {
      const state = reduceReviewEvents(
        [
          event({}),
          event({ eventId: "event-2", reviewerId: "reviewer-2", commentId: 2 }),
          event({
            eventId: "event-3",
            kind: "step-reset",
            publishedDate: "2026-08-13T13:00:00Z",
            commentId: 3,
          }),
        ],
        currentPlan,
      );

      expect([...(state.stepDecisions.get("step-1")?.keys() ?? [])]).toEqual(["reviewer-2"]);
    });

    it("holds nothing for a step nobody has decided on", () => {
      const state = reduceReviewEvents([event({ stepId: "step-1" })], currentPlan);

      expect(state.stepDecisions.get("step-2")).toBeUndefined();
    });
  });

  it("invalidates a step event when its current fingerprint changed", () => {
    const state = reduceReviewEvents(
      [event({ stepFingerprint: "old-fingerprint" })],
      {
        ...currentPlan,
        stepFingerprints: new Map([["step-1", "new-fingerprint"]]),
      },
    );

    expect(state.stepStates.get("reviewer-1")?.has("step-1")).not.toBe(true);
  });
});