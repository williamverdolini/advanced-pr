import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { FeedbackScope } from "./StepActions";

export interface ClearFeedbackDialogProps {
  scope: FeedbackScope;
  /** The step the command was issued from; only meaningful for `step`. */
  stepTitle?: string;
  /** Display names of the reviewers whose decisions are about to go. */
  reviewerNames: readonly string[];
  pending: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

/**
 * The one command in the review that discards other people's work, so it says
 * what it covers and who loses a decision before it is written. Everyone named
 * here is mentioned in the comment the reset writes, so nobody finds a decision
 * of theirs gone without being told.
 */
export function ClearFeedbackDialog({
  scope,
  stepTitle,
  reviewerNames,
  pending,
  onDismiss,
  onConfirm,
}: ClearFeedbackDialogProps): React.ReactElement {
  const wholeReview = scope === "all";

  return (
    <Dialog
      titleProps={{
        text: wholeReview ? "Clear all step feedback" : "Clear feedback on this step",
      }}
      onDismiss={onDismiss}
      footerButtonProps={[
        { text: "Cancel", disabled: pending, onClick: onDismiss },
        {
          text: "Clear and notify",
          primary: true,
          disabled: pending,
          onClick: onConfirm,
        },
      ]}
    >
      <p>
        {wholeReview
          ? "Every approval and change request recorded on this pull request stops counting. The plan and the comments stay as they are."
          : `Every approval and change request on ${stepTitle ? `'${stepTitle}'` : "this step"} stops counting. Other steps are untouched.`}
      </p>
      {reviewerNames.length > 0 ? (
        <p>
          <strong>{reviewerNames.join(", ")}</strong>
          {reviewerNames.length === 1 ? " loses a decision" : " lose a decision"} and{" "}
          {reviewerNames.length === 1 ? "is" : "are"} mentioned in the comment this writes.
        </p>
      ) : (
        <p>There is no decision left to clear here.</p>
      )}
      <MessageCard severity={MessageCardSeverity.Info}>
        Nothing is deleted: the reset is a new comment, and the decisions it clears stay readable
        in the pull request. Reviewer votes are not changed — Azure DevOps only lets each
        reviewer set their own.
      </MessageCard>
    </Dialog>
  );
}
