export type ReviewEventKind =
  | "step-approved"
  | "step-changes-requested"
  | "step-reset"
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

export interface ReducedReviewState {
  stepStates: ReadonlyMap<string, ReadonlyMap<string, StepReviewStatus>>;
  pullRequestDecisions: ReadonlyMap<string, "approved" | "rejected">;
  acceptedEventIds: ReadonlySet<string>;
}

export interface CurrentPlanIdentity {
  planId: string;
  planVersion: number;
  planHash: string;
  stepFingerprints?: ReadonlyMap<string, string>;
}

export type LedgerEventPayload = Omit<
  ReviewEvent,
  "reviewerId" | "publishedDate" | "commentId"
>;

const eventMarkerPattern = /<!--\s*advanced-pr:v2\s+(\{.*?\})\s*-->/s;

export function formatLedgerEvent(label: string, event: LedgerEventPayload): string {
  return `${label}\n\n<!-- advanced-pr:v2 ${JSON.stringify(event)} -->`;
}

export function parseLedgerEvent(
  content: string,
  reviewerId: string,
  publishedDate: string,
  commentId: number,
): ReviewEvent | undefined {
  const match = content.match(eventMarkerPattern);
  if (!match) {
    return undefined;
  }

  try {
    const value = JSON.parse(match[1]) as Partial<LedgerEventPayload> & { kind?: string };
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

  for (const event of events) {
    const currentFingerprint = event.stepId
      ? currentPlan.stepFingerprints?.get(event.stepId)
      : undefined;
    if (
      event.planId === currentPlan.planId &&
      event.planVersion === currentPlan.planVersion &&
      event.planHash === currentPlan.planHash &&
      (!currentFingerprint || event.stepFingerprint === currentFingerprint) &&
      !uniqueEvents.has(event.eventId)
    ) {
      uniqueEvents.set(event.eventId, event);
    }
  }

  const orderedEvents = [...uniqueEvents.values()].sort((left, right) => {
    const dateOrder = left.publishedDate.localeCompare(right.publishedDate);
    return dateOrder || left.commentId - right.commentId;
  });
  const mutableStepStates = new Map<string, Map<string, StepReviewStatus>>();
  const pullRequestDecisions = new Map<string, "approved" | "rejected">();

  for (const event of orderedEvents) {
    if (event.kind === "pr-approved" || event.kind === "pr-rejected") {
      pullRequestDecisions.set(
        event.reviewerId,
        event.kind === "pr-approved" ? "approved" : "rejected",
      );
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

    if (event.kind === "step-reset") {
      reviewerStates.delete(event.stepId);
    } else {
      reviewerStates.set(
        event.stepId,
        event.kind === "step-approved" ? "approved" : "changes-requested",
      );
    }
  }

  return {
    stepStates: mutableStepStates,
    pullRequestDecisions,
    acceptedEventIds: new Set(uniqueEvents.keys()),
  };
}

export function hasOutstandingChanges(
  state: ReducedReviewState,
  reviewerId: string,
): boolean {
  return [...(state.stepStates.get(reviewerId)?.values() ?? [])].some(
    (status) => status === "changes-requested",
  );
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

function isReviewEventKind(value: unknown): value is ReviewEventKind {
  return (
    value === "step-approved" ||
    value === "step-changes-requested" ||
    value === "step-reset" ||
    value === "pr-approved" ||
    value === "pr-rejected"
  );
}
