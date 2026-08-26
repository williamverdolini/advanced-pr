import { describe, expect, it } from "vitest";
import {
  canApprovePullRequest,
  formatLedgerEvent,
  hasOutstandingChanges,
  hasOutstandingChangesAfterApproval,
  notifiesParticipants,
  parseLedgerEvent,
  reduceReviewEvents,
  reviewersWithDecisions,
  summarizeStepApprovals,
  tallyStepDecisions,
  type ReviewEvent,
  type StepDecision,
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

  it("reads back every kind of event it writes", () => {
    // A kind added to the union but not to the runtime guard would be written to
    // the pull request and dropped on the way back, which looks exactly like the
    // action having done nothing.
    const kinds: ReviewEvent["kind"][] = [
      "step-approved",
      "step-changes-requested",
      "step-reset",
      "feedback-cleared",
      "pr-approved",
      "pr-rejected",
    ];

    for (const kind of kinds) {
      const content = formatLedgerEvent("label", event({ kind }));
      expect(parseLedgerEvent(content, "reviewer-1", "2026-08-13T10:00:00Z", 1)?.kind).toBe(kind);
    }
  });

  it("refuses a kind that is only an inherited property name", () => {
    const content = formatLedgerEvent("label", {
      ...event({}),
      kind: "toString" as ReviewEvent["kind"],
    });

    expect(parseLedgerEvent(content, "reviewer-1", "2026-08-13T10:00:00Z", 1)).toBeUndefined();
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

    it("counts a step's decisions, so one request for changes marks it for everybody", () => {
      const state = reduceReviewEvents(
        [
          event({}),
          event({ eventId: "event-2", reviewerId: "reviewer-2", commentId: 2 }),
          event({
            eventId: "event-3",
            reviewerId: "reviewer-3",
            kind: "step-changes-requested",
            commentId: 3,
          }),
        ],
        currentPlan,
      );

      expect(
        tallyStepDecisions([...(state.stepDecisions.get("step-1")?.values() ?? [])]),
      ).toEqual({ approved: 2, changesRequested: 1 });
    });

    it("counts nothing on a step nobody has decided on", () => {
      expect(tallyStepDecisions([])).toEqual({ approved: 0, changesRequested: 0 });
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

  describe("reviewers with decisions", () => {
    const decisions: ReadonlyMap<string, ReadonlyMap<string, StepDecision>> = new Map([
      [
        "step-core",
        new Map([
          ["reviewer-1", { reviewerId: "reviewer-1", status: "approved", publishedDate: "d" }],
        ]),
      ],
      [
        "step-tests",
        new Map([
          ["reviewer-1", { reviewerId: "reviewer-1", status: "approved", publishedDate: "d" }],
          [
            "reviewer-2",
            { reviewerId: "reviewer-2", status: "changes-requested", publishedDate: "d" },
          ],
        ]),
      ],
    ]);

    it("lists them once across every step", () => {
      expect(reviewersWithDecisions(decisions)).toEqual(["reviewer-1", "reviewer-2"]);
    });

    it("lists them for one step, and none for a step nobody decided", () => {
      expect(reviewersWithDecisions(decisions, "step-core")).toEqual(["reviewer-1"]);
      expect(reviewersWithDecisions(decisions, "step-gone")).toEqual([]);
    });
  });

  it("drops a decision on a step the plan no longer has", () => {
    const state = reduceReviewEvents([event({ stepId: "step-gone" })], {
      ...currentPlan,
      stepFingerprints: new Map([["step-1", "fingerprint-1"]]),
    });

    // Otherwise the decision is invisible and still counted: a stale
    // `changes-requested` would block that reviewer's sign-off for good.
    expect(state.stepStates.get("reviewer-1")).toBeUndefined();
  });

  it("clears a step on a plan still under the original rule", () => {
    // The reset must work on a pull request whose plan predates the opt-in, and
    // it carries no fingerprint of its own to be weighed against.
    const state = reduceReviewEvents(
      [
        event({ stepFingerprint: "fingerprint-1" }),
        event({
          eventId: "event-2",
          kind: "feedback-cleared",
          reviewerId: "author-1",
          stepFingerprint: undefined,
          publishedDate: "2026-08-13T11:00:00Z",
          commentId: 2,
        }),
      ],
      {
        ...currentPlan,
        authorId: "author-1",
        stepFingerprints: new Map([["step-1", "fingerprint-1"]]),
      },
    );

    expect(state.stepStates.get("reviewer-1")?.has("step-1")).toBe(false);
  });

  describe("manual invalidation", () => {
    const manualPlan = {
      planId: "plan-1",
      planVersion: 4,
      planHash: "hash-4",
      invalidation: "manual",
      authorId: "author-1",
      stepFingerprints: new Map([
        ["step-core", "fingerprint-now"],
        ["step-tests", "fingerprint-now"],
      ]),
    } as const;

    const approvedCore = event({
      stepId: "step-core",
      planVersion: 1,
      planHash: "hash-1",
      stepFingerprint: "fingerprint-then",
    });

    it("keeps a decision across plan revisions and file changes", () => {
      const state = reduceReviewEvents([approvedCore], manualPlan);

      expect(state.stepStates.get("reviewer-1")?.get("step-core")).toBe("approved");
    });

    it("still drops a decision on a step that is gone, renamed included", () => {
      const state = reduceReviewEvents(
        [event({ stepId: "step-sorting", kind: "step-changes-requested" })],
        manualPlan,
      );

      expect(state.stepStates.get("reviewer-1")).toBeUndefined();
      expect(hasOutstandingChanges(state, "reviewer-1")).toBe(false);
    });

    it("lets the author clear one step for every reviewer", () => {
      const state = reduceReviewEvents(
        [
          approvedCore,
          event({ eventId: "event-2", reviewerId: "reviewer-2", stepId: "step-tests" }),
          event({
            eventId: "event-3",
            kind: "feedback-cleared",
            reviewerId: "author-1",
            stepId: "step-core",
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 3,
          }),
        ],
        manualPlan,
      );

      expect(state.stepStates.get("reviewer-1")?.has("step-core")).toBe(false);
      expect(state.stepDecisions.get("step-core")).toBeUndefined();
      expect(state.stepStates.get("reviewer-2")?.get("step-tests")).toBe("approved");
    });

    it("lets the author clear every step at once", () => {
      const state = reduceReviewEvents(
        [
          approvedCore,
          event({ eventId: "event-2", reviewerId: "reviewer-2", stepId: "step-tests" }),
          event({
            eventId: "event-3",
            kind: "feedback-cleared",
            reviewerId: "author-1",
            stepId: undefined,
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 3,
          }),
        ],
        manualPlan,
      );

      expect(state.stepStates.size).toBe(0);
      expect(state.stepDecisions.size).toBe(0);
    });

    it("keeps a decision recorded after the reset", () => {
      const state = reduceReviewEvents(
        [
          event({
            eventId: "event-1",
            kind: "feedback-cleared",
            reviewerId: "author-1",
            stepId: undefined,
          }),
          event({
            eventId: "event-2",
            stepId: "step-core",
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 2,
          }),
        ],
        manualPlan,
      );

      expect(state.stepStates.get("reviewer-1")?.get("step-core")).toBe("approved");
    });

    it("takes a reset from the author whatever the case of the identity id", () => {
      const state = reduceReviewEvents(
        [
          approvedCore,
          event({
            eventId: "event-2",
            kind: "feedback-cleared",
            reviewerId: "AUTHOR-1",
            stepId: undefined,
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 2,
          }),
        ],
        manualPlan,
      );

      expect(state.stepStates.size).toBe(0);
    });

    it("ignores a reset written by anyone but the pull request author", () => {
      const state = reduceReviewEvents(
        [
          approvedCore,
          event({
            eventId: "event-2",
            kind: "feedback-cleared",
            reviewerId: "reviewer-2",
            stepId: undefined,
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 2,
          }),
        ],
        manualPlan,
      );

      // Anyone can write a comment carrying a marker, so the reducer must not
      // take a reset from anyone but the author.
      expect(state.stepStates.get("reviewer-1")?.get("step-core")).toBe("approved");
    });

    it("ignores a reset when no author is known", () => {
      const state = reduceReviewEvents(
        [
          approvedCore,
          event({
            eventId: "event-2",
            kind: "feedback-cleared",
            reviewerId: "author-1",
            stepId: undefined,
            publishedDate: "2026-08-13T11:00:00Z",
            commentId: 2,
          }),
        ],
        { ...manualPlan, authorId: undefined },
      );

      expect(state.stepStates.get("reviewer-1")?.get("step-core")).toBe("approved");
    });

    it("keeps refusing an event from another plan", () => {
      const state = reduceReviewEvents(
        [event({ stepId: "step-core", planId: "plan-2" })],
        manualPlan,
      );

      expect(state.stepStates.size).toBe(0);
    });
  });
});
describe("the envelope a recorded event is written in", () => {
  const event = {
    kind: "step-approved" as const,
    eventId: "5858bf60-458d-4b60-8596-b8d2b61670b6",
    planId: "8b8cbcc1-6029-4610-a1d2-38ec5fa0eb00",
    planVersion: 1,
    planHash: "0babc753",
    stepId: "step-grid-and-card",
    iteration: 3,
    stepFingerprint: "d49c31e3",
  };

  it("survives a round trip through the newer envelope", () => {
    const content = formatLedgerEvent("✅ Step approved: Grid and card", event);

    expect(content).toContain("[//]: # (advanced-pr:v3");
    expect(content).not.toContain("<!--");
    expect(parseLedgerEvent(content, "reviewer-1", "2026-08-25T09:31:00Z", 42)).toMatchObject(
      event,
    );
  });

  it("still reads a decision recorded before the envelope changed", () => {
    // The ledger is append-only: every approval already in a pull request is a
    // v2 comment, and it has to keep counting.
    const v2 = `✅ Step approved: Grid and card\n\n<!-- advanced-pr:v2 ${JSON.stringify(
      event,
    )} -->`;

    expect(parseLedgerEvent(v2, "reviewer-1", "2026-08-25T09:31:00Z", 42)).toMatchObject(event);
  });
});

// The question this answers: a pull request already under review holds nothing
// but v2 comments. Reading them has to keep producing the same approvals, and a
// new decision written beside them has to join them rather than replace them.
describe("a review that started before the envelope changed", () => {
  const payload = {
    kind: "step-approved" as const,
    eventId: "event-old",
    planId: "plan-1",
    planVersion: 1,
    planHash: "hash-1",
    stepId: "step-1",
  };
  const asV2 = (value: object): string =>
    `Step approved\n\n<!-- advanced-pr:v2 ${JSON.stringify(value)} -->`;

  it("still counts an approval recorded in the old envelope", () => {
    const old = parseLedgerEvent(asV2(payload), "reviewer-1", "2026-08-13T10:00:00Z", 1);
    expect(old).toBeDefined();

    const state = reduceReviewEvents([old!], currentPlan);
    expect(state.stepStates.get("reviewer-1")?.get("step-1")).toBe("approved");
  });

  it("reads both envelopes in the same pull request", () => {
    const old = parseLedgerEvent(asV2(payload), "reviewer-1", "2026-08-13T10:00:00Z", 1);
    const fresh = parseLedgerEvent(
      formatLedgerEvent("Step approved", {
        ...payload,
        eventId: "event-new",
        stepId: "step-2",
      }),
      "reviewer-1",
      "2026-08-25T10:00:00Z",
      2,
    );

    const state = reduceReviewEvents([old!, fresh!], currentPlan);
    const steps = state.stepStates.get("reviewer-1");
    expect(steps?.get("step-1")).toBe("approved");
    expect(steps?.get("step-2")).toBe("approved");
  });

  it("lets a new decision supersede one recorded in the old envelope", () => {
    // Same reviewer, same step: the later comment wins whichever envelope each
    // of the two was written in.
    const old = parseLedgerEvent(asV2(payload), "reviewer-1", "2026-08-13T10:00:00Z", 1);
    const reversal = parseLedgerEvent(
      formatLedgerEvent("Changes requested", {
        ...payload,
        eventId: "event-new",
        kind: "step-changes-requested",
      }),
      "reviewer-1",
      "2026-08-25T10:00:00Z",
      2,
    );

    const state = reduceReviewEvents([old!, reversal!], currentPlan);
    expect(state.stepStates.get("reviewer-1")?.get("step-1")).toBe("changes-requested");
  });
});

describe("which recorded events reach people's inbox", () => {
  it("keeps a decision on one step quiet", () => {
    // The noise the reviewers asked to be rid of: one mail per step, per
    // reviewer, to everyone who has ever written in the ledger thread.
    expect(notifiesParticipants("step-approved")).toBe(false);
    expect(notifiesParticipants("step-changes-requested")).toBe(false);
    expect(notifiesParticipants("step-reset")).toBe(false);
  });

  it("announces the two nobody can afford to miss", () => {
    // Clearing feedback mentions each reviewer whose approval it discards, and
    // that mention is how they find out; a sign-off ends the review.
    expect(notifiesParticipants("feedback-cleared")).toBe(true);
    expect(notifiesParticipants("pr-approved")).toBe(true);
    expect(notifiesParticipants("pr-rejected")).toBe(true);
  });
});
