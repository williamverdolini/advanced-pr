import * as React from "react";
import {
  canApprovePullRequest,
  hasOutstandingChangesAfterApproval,
  reduceReviewEvents,
  type StepDecision,
  type StepReviewStatus,
} from "../core/ledger";
import type { ReviewStep } from "../core/reviewPlan";
import {
  appendLedgerEvent,
  createReviewPlan,
  setReviewerVote,
  type PullRequestWorkspace,
} from "../platform/azureDevOpsClient";
import type { StepDecisionKind } from "./StepActions";
import { usePendingAction } from "./usePendingAction";

export interface ReviewStateInput {
  workspace: PullRequestWorkspace;
  reviewerId: string;
  /** The Markdown currently in the plan editor. */
  planDraft: string;
  onRefresh: () => Promise<unknown>;
  /** Approving a step moves on to the next one that still needs a decision. */
  onAdvanceToStep: (step: ReviewStep) => void;
  onPlanCreated: () => void;
}

export interface ReviewState {
  /** Steps worth showing: the catch-all is hidden while it holds no files. */
  displayedSteps: readonly ReviewStep[];
  /** This reviewer's decision per step, rebuilt from the ledger. */
  reviewerSteps?: ReadonlyMap<string, StepReviewStatus>;
  /** Every reviewer's decision, keyed step then reviewer. */
  stepDecisions: ReadonlyMap<string, ReadonlyMap<string, StepDecision>>;
  currentReviewerVote?: number;
  reviewClosed: boolean;
  pending: boolean;
  error?: string;
  signOffOpen: boolean;
  setSignOffOpen: (open: boolean) => void;
  decideStep: (step: ReviewStep, decision: StepDecisionKind) => void;
  approvePullRequest: () => void;
  createPlan: () => void;
}

/**
 * The review as a set of decisions: what this reviewer has already recorded,
 * derived from the ledger comments, and the three writes that add to it. Every
 * write appends an event and then re-reads, because the ledger, not this state,
 * is the source of truth.
 */
export function useReviewState({
  workspace,
  reviewerId,
  planDraft,
  onRefresh,
  onAdvanceToStep,
  onPlanCreated,
}: ReviewStateInput): ReviewState {
  const { plan } = workspace;
  const {
    pending,
    error,
    run: runAction,
  } = usePendingAction("Unable to complete this action.");
  const [signOffOpen, setSignOffOpen] = React.useState(false);

  const reviewState = reduceReviewEvents(workspace.ledgerEvents, {
    planId: plan.planId,
    planVersion: plan.version,
    planHash: plan.planHash,
    stepFingerprints: new Map(plan.steps.map((step) => [step.stepId, step.fingerprint])),
  });
  const reviewerSteps = reviewState.stepStates.get(reviewerId);
  const displayedSteps = plan.steps.filter(
    (step) => !step.isCatchAll || step.files.length > 0,
  );
  const currentReviewerVote = workspace.reviewers.find(
    (reviewer) => reviewer.id === reviewerId,
  )?.vote;

  // No special case for a pull request without a plan: it simply has one step,
  // `Everything else`, treated exactly like any other.
  const signOffReady = canApprovePullRequest(
    reviewState,
    reviewerId,
    plan.steps.map((step) => ({
      stepId: step.stepId,
      requiresApproval: step.files.length > 0,
    })),
  );
  // The ledger is append-only, so a past `pr-approved` never disappears. The
  // vote on the pull request is the source of truth: if it was reset (here or in
  // the classic UI, which writes no event), the sign-off is offered again.
  const signOffInEffect =
    reviewState.pullRequestDecisions.get(reviewerId) === "approved" &&
    currentReviewerVote === 10;

  // A pull request that is no longer active accepts no votes and no plan
  // changes, so every review action in the toolbar is closed.
  const reviewClosed = workspace.state !== "active";

  // Asks for the sign-off the moment the last required step is approved, and
  // only on that transition: dismissing it must not make it pop back.
  const signOffPrompted = React.useRef(false);
  React.useEffect(() => {
    if (!signOffReady || signOffInEffect || reviewClosed) {
      signOffPrompted.current = false;
      return;
    }

    if (!signOffPrompted.current) {
      signOffPrompted.current = true;
      setSignOffOpen(true);
    }
  }, [reviewClosed, signOffInEffect, signOffReady]);

  const decideStep = (step: ReviewStep, decision: StepDecisionKind): void => {
    void runAction(async () => {
      await appendLedgerEvent(workspace, describeDecision(step, decision), {
        eventId: crypto.randomUUID(),
        kind: decision,
        planId: plan.planId,
        planVersion: plan.version,
        planHash: plan.planHash,
        stepId: step.stepId,
        iteration: workspace.iterationId,
        stepFingerprint: step.fingerprint,
      });
      if (decision === "step-changes-requested") {
        await setReviewerVote(workspace, reviewerId, -5);
      } else if (
        decision === "step-approved" &&
        currentReviewerVote === -5 &&
        !hasOutstandingChangesAfterApproval(reviewState, reviewerId, step.stepId)
      ) {
        await setReviewerVote(workspace, reviewerId, 0);
      }
      await onRefresh();
      if (decision === "step-approved") {
        const currentIndex = displayedSteps.findIndex((item) => item.stepId === step.stepId);
        const nextStep = displayedSteps
          .slice(currentIndex + 1)
          .find(
            (item) => item.files.length > 0 && reviewerSteps?.get(item.stepId) !== "approved",
          );
        if (nextStep) {
          onAdvanceToStep(nextStep);
        }
      }
    }, "Unable to update this step.");
  };

  const approvePullRequest = (): void => {
    void runAction(async () => {
      await appendLedgerEvent(workspace, "✅ **Pull request approved**", {
        eventId: crypto.randomUUID(),
        kind: "pr-approved",
        planId: plan.planId,
        planVersion: plan.version,
        planHash: plan.planHash,
        iteration: workspace.iterationId,
      });
      await setReviewerVote(workspace, reviewerId, 10);
      setSignOffOpen(false);
      await onRefresh();
    }, "Unable to approve the pull request.");
  };

  const createPlan = (): void => {
    if (!planDraft.trim()) {
      return;
    }

    void runAction(async () => {
      await createReviewPlan(
        workspace,
        plan.sourceThreadId ? plan.planId : crypto.randomUUID(),
        plan.sourceThreadId ? plan.version + 1 : 1,
        planDraft,
      );
      onPlanCreated();
      await onRefresh();
    }, "Unable to create the review plan.");
  };

  return {
    displayedSteps,
    reviewerSteps,
    stepDecisions: reviewState.stepDecisions,
    currentReviewerVote,
    reviewClosed,
    pending,
    error,
    signOffOpen,
    setSignOffOpen,
    decideStep,
    approvePullRequest,
    createPlan,
  };
}

/** The human-readable half of a ledger event, which is what Azure DevOps shows. */
function describeDecision(step: ReviewStep, decision: StepDecisionKind): string {
  if (decision === "step-approved") {
    return `✅ **Step approved: \`${step.title}\`**`;
  }
  if (decision === "step-changes-requested") {
    return `⚠️ **Changes requested: \`${step.title}\`**`;
  }

  return `↩ **Step reset: \`${step.title}\`**`;
}
