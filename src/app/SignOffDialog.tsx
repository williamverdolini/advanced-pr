import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import type { PullRequestWorkspace } from "../platform/azureDevOpsClient";

export interface SignOffDialogProps {
  workspace: PullRequestWorkspace;
  reviewerId: string;
  currentVote?: number;
  pending: boolean;
  onDismiss: () => void;
  onConfirm: () => void;
}

/**
 * Approving the last step is not a vote (§5.3): the whole pull request is a
 * separate, explicit decision, and this dialog is where it is stated, with
 * what it covers and what it does to the reviewer's global vote.
 */
export function SignOffDialog({
  workspace,
  reviewerId,
  currentVote,
  pending,
  onDismiss,
  onConfirm,
}: SignOffDialogProps): React.ReactElement {
  const reviewedSteps = workspace.plan.steps.filter((step) => step.files.length > 0);
  const myOpenThreads = workspace.threads.filter(
    (thread) =>
      thread.isOpen && thread.comments.some((comment) => comment.authorId === reviewerId),
  );

  return (
    <Dialog
      titleProps={{ text: "Approve pull request" }}
      onDismiss={onDismiss}
      footerButtonProps={[
        { text: "Cancel", disabled: pending, onClick: onDismiss },
        { text: "Approve pull request", primary: true, disabled: pending, onClick: onConfirm },
      ]}
    >
      <p>
        You are approving the whole pull request: {reviewedSteps.length}{" "}
        {reviewedSteps.length === 1 ? "step" : "steps"}, {workspace.files.length}{" "}
        {workspace.files.length === 1 ? "file" : "files"}.
      </p>
      <p>
        Your vote on the pull request becomes <strong>Approved</strong>
        {currentVote !== undefined && currentVote !== 0 && (
          <> (it is currently {describeVote(currentVote)})</>
        )}
        .
      </p>
      {myOpenThreads.length > 0 && (
        <MessageCard severity={MessageCardSeverity.Warning}>
          {myOpenThreads.length} {myOpenThreads.length === 1 ? "thread" : "threads"} you took part
          in {myOpenThreads.length === 1 ? "is" : "are"} still open. You can approve anyway.
        </MessageCard>
      )}
    </Dialog>
  );
}

function describeVote(vote: number): string {
  switch (vote) {
    case 10:
      return "Approved";
    case 5:
      return "Approved with suggestions";
    case -5:
      return "Waiting for author";
    case -10:
      return "Rejected";
    default:
      return "No vote";
  }
}
