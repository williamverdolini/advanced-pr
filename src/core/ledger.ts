import { formatMarker, readMarkerPayload } from "./marker";
import type { PlanInvalidation } from "./reviewPlan";

export type ReviewEventKind =
  | "step-approved"
  | "step-changes-requested"
  | "step-reset"
  /**
   * The pull request author discarding everybody's feedback: on one step when
   * the event names it, on every step when it does not. `step-reset` is the
   * reviewer's own retraction and stays that; this one is the only event that
   * reaches across reviewers, which is why it is honoured from the author alone.
   */
  | "feedback-cleared"
  | "pr-approved"
  | "pr-rejected";

export interface ReviewEvent {
  eventId: string;
  kind: ReviewEventKind;
  planId: string;
  planVersion: number;
  planHash: string;
  reviewerId: string;
  publishedDate: string;
  commentId: number;
  stepId?: string;
  iteration?: number;
  stepFingerprint?: string;
}

export type StepReviewStatus = "approved" | "changes-requested";

export interface StepDecision {
  reviewerId: string;
  status: StepReviewStatus;
  /** When the decision that still stands was recorded. */
  publishedDate: string;
}

export interface ReducedReviewState {
  /** Keyed reviewer, then step: what that one reviewer has decided. */
  stepStates: ReadonlyMap<string, ReadonlyMap<string, StepReviewStatus>>;
  /**
   * The same decisions read the other way round, keyed step then reviewer, and
   * keeping the date. It answers "who has signed off on this step", which the
   * per-reviewer view cannot without a scan.
   */
  stepDecisions: ReadonlyMap<string, ReadonlyMap<string, StepDecision>>;
  pullRequestDecisions: ReadonlyMap<string, "approved" | "rejected">;
  acceptedEventIds: ReadonlySet<string>;
}

export interface CurrentPlanIdentity {
  planId: string;
  planVersion: number;
  planHash: string;
  stepFingerprints?: ReadonlyMap<string, string>;
  /** Defaults to the original rule, so a caller that omits it gets it. */
  invalidation?: PlanInvalidation;
  /**
   * Who may clear other reviewers' feedback. Anyone can write a comment carrying
   * a marker, so without this a reviewer could wipe the whole review; omitting it
   * means no `feedback-cleared` event is honoured at all.
   */
  authorId?: string;
}

export type LedgerEventPayload = Omit<
  ReviewEvent,
  "reviewerId" | "publishedDate" | "commentId"
>;

export function formatLedgerEvent(label: string, event: LedgerEventPayload): string {
  return `${label}\n\n${formatMarker(event)}`;
}

export function parseLedgerEvent(
  content: string,
  reviewerId: string,
  publishedDate: string,
  commentId: number,
): ReviewEvent | undefined {
  const payload = readMarkerPayload(content);
  if (!payload) {
    return undefined;
  }

  try {
    const value = JSON.parse(payload) as Partial<LedgerEventPayload> & { kind?: string };
    if (
      !isReviewEventKind(value.kind) ||
      typeof value.eventId !== "string" ||
      typeof value.planId !== "string" ||
      !Number.isInteger(value.planVersion) ||
      typeof value.planHash !== "string"
    ) {
      return undefined;
    }

    return {
      eventId: value.eventId,
      kind: value.kind,
      planId: value.planId,
      planVersion: value.planVersion as number,
      planHash: value.planHash,
      reviewerId,
      publishedDate,
      commentId,
      stepId: value.stepId,
      iteration: value.iteration,
      stepFingerprint: value.stepFingerprint,
    };
  } catch {
    return undefined;
  }
}

export function reduceReviewEvents(
  events: readonly ReviewEvent[],
  currentPlan: CurrentPlanIdentity,
): ReducedReviewState {
  const uniqueEvents = new Map<string, ReviewEvent>();
  const manual = currentPlan.invalidation === "manual";

  for (const event of events) {
    if (event.planId !== currentPlan.planId || uniqueEvents.has(event.eventId)) {
      continue;
    }

    // Under `manual` nothing about the plan document is compared: the step's
    // identity and the author's own reset are the whole rule (§4.3).
    if (!manual) {
      // A reset is an act on the step, not a judgement on its contents, so it is
      // not weighed against the shape the step had: it clears what was decided
      // before it whatever has happened to the files since.
      const currentFingerprint =
        event.stepId && event.kind !== "feedback-cleared"
          ? currentPlan.stepFingerprints?.get(event.stepId)
          : undefined;
      if (
        event.planVersion !== currentPlan.planVersion ||
        event.planHash !== currentPlan.planHash ||
        (currentFingerprint && event.stepFingerprint !== currentFingerprint)
      ) {
        continue;
      }
    }

    // A decision on a step the plan no longer has would be invisible but still
    // counted: a stale `changes-requested` would block that reviewer's sign-off
    // with nothing on screen to clear. Under the original rule this can never
    // happen — the same plan hash means the same steps — so it costs nothing
    // there and is what makes renaming and removing a step invalidate under
    // `manual`.
    if (event.stepId && currentPlan.stepFingerprints && !currentPlan.stepFingerprints.has(event.stepId)) {
      continue;
    }

    uniqueEvents.set(event.eventId, event);
  }

  const orderedEvents = [...uniqueEvents.values()].sort((left, right) => {
    const dateOrder = left.publishedDate.localeCompare(right.publishedDate);
    return dateOrder || left.commentId - right.commentId;
  });
  const mutableStepStates = new Map<string, Map<string, StepReviewStatus>>();
  // Built in the same pass, so the ordering and the meaning of a reset have one
  // implementation rather than two that can drift.
  const mutableStepDecisions = new Map<string, Map<string, StepDecision>>();
  const pullRequestDecisions = new Map<string, "approved" | "rejected">();

  for (const event of orderedEvents) {
    if (event.kind === "pr-approved" || event.kind === "pr-rejected") {
      pullRequestDecisions.set(
        event.reviewerId,
        event.kind === "pr-approved" ? "approved" : "rejected",
      );
      continue;
    }

    if (event.kind === "feedback-cleared") {
      if (
        currentPlan.authorId &&
        event.reviewerId.toLowerCase() === currentPlan.authorId.toLowerCase()
      ) {
        clearFeedback(mutableStepStates, mutableStepDecisions, event.stepId);
      }
      continue;
    }

    if (!event.stepId) {
      continue;
    }

    let reviewerStates = mutableStepStates.get(event.reviewerId);
    if (!reviewerStates) {
      reviewerStates = new Map<string, StepReviewStatus>();
      mutableStepStates.set(event.reviewerId, reviewerStates);
    }

    let stepReviewers = mutableStepDecisions.get(event.stepId);
    if (!stepReviewers) {
      stepReviewers = new Map<string, StepDecision>();
      mutableStepDecisions.set(event.stepId, stepReviewers);
    }

    if (event.kind === "step-reset") {
      reviewerStates.delete(event.stepId);
      stepReviewers.delete(event.reviewerId);
    } else {
      const status = event.kind === "step-approved" ? "approved" : "changes-requested";
      reviewerStates.set(event.stepId, status);
      stepReviewers.set(event.reviewerId, {
        reviewerId: event.reviewerId,
        status,
        publishedDate: event.publishedDate,
      });
    }
  }

  return {
    stepStates: mutableStepStates,
    stepDecisions: mutableStepDecisions,
    pullRequestDecisions,
    acceptedEventIds: new Set(uniqueEvents.keys()),
  };
}

/**
 * Wipes what every reviewer had decided, on one step or on all of them. Applied
 * in date order like every other event, so a decision recorded after the reset
 * survives it.
 */
function clearFeedback(
  stepStates: Map<string, Map<string, StepReviewStatus>>,
  stepDecisions: Map<string, Map<string, StepDecision>>,
  stepId: string | undefined,
): void {
  if (!stepId) {
    stepStates.clear();
    stepDecisions.clear();
    return;
  }

  stepDecisions.delete(stepId);
  for (const reviewerStates of stepStates.values()) {
    reviewerStates.delete(stepId);
  }
}

export function hasOutstandingChanges(
  state: ReducedReviewState,
  reviewerId: string,
): boolean {
  return [...(state.stepStates.get(reviewerId)?.values() ?? [])].some(
    (status) => status === "changes-requested",
  );
}

/**
 * Who has decided on one step, or on any step when none is named. It is the list
 * a reset takes something away from, so it drives both the confirmation the
 * author sees and the people the reset comment mentions.
 */
export function reviewersWithDecisions(
  stepDecisions: ReadonlyMap<string, ReadonlyMap<string, StepDecision>>,
  stepId?: string,
): string[] {
  const byStep = stepId
    ? [stepDecisions.get(stepId) ?? new Map<string, StepDecision>()]
    : [...stepDecisions.values()];
  return [...new Set(byStep.flatMap((byReviewer) => [...byReviewer.keys()]))];
}

export interface StepDecisionTally {
  approved: number;
  changesRequested: number;
}

/**
 * Every reviewer's decision on one step, counted. `summarizeStepApprovals` asks
 * the same question for one reviewer across the steps; the wizard needs it the
 * other way round, because a step anyone has asked changes on is a step the
 * whole pull request should see as unfinished, not only its author.
 */
export function tallyStepDecisions(
  decisions: readonly StepDecision[],
): StepDecisionTally {
  return {
    approved: decisions.filter((decision) => decision.status === "approved").length,
    changesRequested: decisions.filter(
      (decision) => decision.status === "changes-requested",
    ).length,
  };
}

export interface StepApprovalRequirement {
  stepId: string;
  /** Empty steps are informational and never block the sign-off (§5.3). */
  requiresApproval: boolean;
}

export interface StepApprovalSummary {
  /** Steps that carry files and therefore need this reviewer's approval. */
  required: number;
  approved: number;
  changesRequested: number;
}

/** Drives both the sign-off gate and the progress the UI shows for it. */
export function summarizeStepApprovals(
  state: ReducedReviewState,
  reviewerId: string,
  steps: readonly StepApprovalRequirement[],
): StepApprovalSummary {
  const reviewerSteps = state.stepStates.get(reviewerId);
  const required = steps.filter((step) => step.requiresApproval);

  return {
    required: required.length,
    approved: required.filter((step) => reviewerSteps?.get(step.stepId) === "approved").length,
    changesRequested: [...(reviewerSteps?.values() ?? [])].filter(
      (status) => status === "changes-requested",
    ).length,
  };
}

/**
 * The reviewer may sign off the whole pull request once every step that needs
 * approval carries theirs and none of their steps asks for changes. Approving
 * the last step never votes on its own: the decision stays explicit.
 */
export function canApprovePullRequest(
  state: ReducedReviewState,
  reviewerId: string,
  steps: readonly StepApprovalRequirement[],
): boolean {
  const summary = summarizeStepApprovals(state, reviewerId, steps);
  return (
    summary.required > 0 &&
    summary.approved === summary.required &&
    summary.changesRequested === 0
  );
}

export function hasOutstandingChangesAfterApproval(
  state: ReducedReviewState,
  reviewerId: string,
  approvedStepId: string,
): boolean {
  return [...(state.stepStates.get(reviewerId)?.entries() ?? [])].some(
    ([stepId, status]) =>
      stepId !== approvedStepId && status === "changes-requested",
  );
}

/**
 * Keyed by kind rather than a chain of comparisons on purpose: `Record` makes
 * the compiler demand an entry for every member of the union, so a kind added to
 * the type but not here is a build error instead of an event that is written to
 * the pull request and silently dropped when read back.
 */
const reviewEventKinds: Readonly<Record<ReviewEventKind, true>> = {
  "step-approved": true,
  "step-changes-requested": true,
  "step-reset": true,
  "feedback-cleared": true,
  "pr-approved": true,
  "pr-rejected": true,
};

function isReviewEventKind(value: unknown): value is ReviewEventKind {
  // `hasOwn`, not `in`: every object inherits `toString` and friends.
  return typeof value === "string" && Object.hasOwn(reviewEventKinds, value);
}
