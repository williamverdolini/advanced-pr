import * as React from "react";
import { IconSize } from "azure-devops-ui/Icon";
import { MoreButton } from "azure-devops-ui/Menu";
import { SplitButton } from "azure-devops-ui/SplitButton";
import type { StepReviewStatus } from "../core/ledger";
import type { ReviewStep } from "../core/reviewPlan";

/** Which decision a menu entry records. Not to be confused with `core/ledger`'s
 *  `StepDecision`, which is a decision already recorded, by whom and when. */
export type StepDecisionKind = "step-approved" | "step-changes-requested" | "step-reset";

export interface StepActionsProps {
  step?: ReviewStep;
  status?: StepReviewStatus;
  pending: boolean;
  reviewClosed: boolean;
  /** Only the pull request author may write or revise the plan. */
  isAuthor: boolean;
  planExists: boolean;
  onDecision: (step: ReviewStep, decision: StepDecisionKind) => void;
  onTogglePlanEditor: () => void;
}

/**
 * The review commands for the selected step. The sign-off has no button of its
 * own on purpose: completing the steps is what raises it, through the dialog.
 */
export function StepActions({
  step,
  status,
  pending,
  reviewClosed,
  isAuthor,
  planExists,
  onDecision,
  onTogglePlanEditor,
}: StepActionsProps): React.ReactElement {
  return (
    <div className="toolbar-actions">
      {step && (
        <SplitButton
          disabled={pending || reviewClosed || step.files.length === 0}
          buttonProps={{
            text: status === "approved" ? "Approved step" : "Approve step",
            disabled: status === "approved",
            tooltipProps: {
              text: describeStepApproval(step.files.length, status, reviewClosed),
            },
            onClick: () => onDecision(step, "step-approved"),
          }}
          menuButtonProps={{
            contextualMenuProps: {
              onActivate: (menuItem) => {
                if (isStepDecisionKind(menuItem.id)) {
                  onDecision(step, menuItem.id);
                }
              },
              menuProps: {
                id: "advanced-pr-step-actions",
                items: [
                  {
                    // The menu lists every decision, the main action included:
                    // reaching for the dropdown should not hide the one command
                    // the reviewer is most likely after.
                    id: "step-approved",
                    text: "Approve step",
                    iconProps: {
                      iconName: "CompletedSolid",
                      className: "feedback-icon feedback-icon-success",
                      size: IconSize.medium,
                    },
                    disabled: status === "approved",
                  },
                  {
                    id: "step-changes-requested",
                    text: "Request changes",
                    iconProps: {
                      iconName: "AwayStatus",
                      className: "feedback-icon feedback-icon-waiting",
                      size: IconSize.medium,
                    },
                  },
                  {
                    id: "step-reset",
                    text: "Reset step",
                    iconProps: {
                      iconName: "CircleRing",
                      className: "feedback-icon feedback-icon-neutral",
                      size: IconSize.medium,
                    },
                    hidden: !status,
                  },
                ],
              },
            },
          }}
        />
      )}
      {isAuthor && (
        <MoreButton
          disabled={pending || reviewClosed}
          contextualMenuProps={{
            onActivate: (menuItem) => {
              if (menuItem.id === "toggle-plan-editor") {
                onTogglePlanEditor();
              }
            },
            menuProps: {
              id: "advanced-pr-more-actions",
              items: [
                {
                  id: "toggle-plan-editor",
                  text: planExists ? "Edit plan" : "Create plan",
                  iconProps: { iconName: "Edit", size: IconSize.small },
                },
              ],
            },
          }}
        />
      )}
    </div>
  );
}

/**
 * The step command is always on screen, so it has to say why it cannot act
 * rather than disappear and leave the toolbar looking different per pull
 * request.
 */
function describeStepApproval(
  fileCount: number,
  status: StepReviewStatus | undefined,
  reviewClosed: boolean,
): string {
  if (reviewClosed) {
    return "This pull request is no longer active";
  }
  if (fileCount === 0) {
    return "This step has no files to review";
  }
  if (status === "approved") {
    return "You approved this step";
  }

  return "Approve this step";
}

function isStepDecisionKind(id: string | undefined): id is StepDecisionKind {
  return (
    id === "step-approved" || id === "step-changes-requested" || id === "step-reset"
  );
}
