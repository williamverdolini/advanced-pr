import * as React from "react";
import { Dialog } from "azure-devops-ui/Dialog";
import { MessageCard, MessageCardSeverity } from "azure-devops-ui/MessageCard";
import { isGeneratedComment } from "../core/marker";
import type { PullRequestWorkspace } from "../platform/azureDevOpsClient";

/**
 * Which of the two Azure DevOps approving votes the sign-off records. Both are
 * offered as their own button rather than derived from the open threads: only
 * the reviewer knows whether what they left behind is blocking.
 */
export type PullRequestApproval = "approved" | "approved-with-suggestions";

export interface SignOffDialogProps {
  workspace: PullRequestWorkspace;
  reviewerId: string;
  currentVote?: number;
  pending: boolean;
  onDismiss: () => void;
  onConfirm: (approval: PullRequestApproval) => void;
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
  // Only discussions count, and the test is per comment rather than per thread:
  // the plan and every recorded decision are comments this extension wrote, and
  // the plan thread is also the ledger, so a thread-level rule would either
  // count them all or hide a real reply to the plan.
  const myOpenThreads = workspace.threads.filter(
    (thread) =>
      thread.isOpen &&
      thread.comments.some(
        (comment) => comment.authorId === reviewerId && !isGeneratedComment(comment.content),
      ),
  );

  // The suggestion is the primary button when the reviewer left a thread open:
  // it is the likelier intent there, and the plain approval stays one click away.
  const suggestionsFirst = myOpenThreads.length > 0;

  return (
    <Dialog
      titleProps={{ text: "Approve pull request" }}
      onDismiss={onDismiss}
      footerButtonProps={[
        { text: "Cancel", disabled: pending, onClick: onDismiss },
        {
          text: "Approve with suggestions",
          primary: suggestionsFirst,
          disabled: pending,
          onClick: () => onConfirm("approved-with-suggestions"),
        },
        {
          text: "Approve",
          primary: !suggestionsFirst,
          disabled: pending,
          onClick: () => onConfirm("approved"),
        },
      ]}
    >
      <p>
        You are approving the whole pull request: {reviewedSteps.length}{" "}
        {reviewedSteps.length === 1 ? "step" : "steps"}, {workspace.files.length}{" "}
        {workspace.files.length === 1 ? "file" : "files"}.
      </p>
      <p>
        Your vote on the pull request becomes <strong>Approved</strong> or{" "}
        <strong>Approved with suggestions</strong>, depending on the button you choose
        {currentVote !== undefined && currentVote !== 0 && (
          <> (it is currently {describeVote(currentVote)})</>
        )}
        .
      </p>
      {myOpenThreads.length > 0 && (
        <MessageCard severity={MessageCardSeverity.Warning}>
          {myOpenThreads.length} {myOpenThreads.length === 1 ? "thread" : "threads"} you took part
          in {myOpenThreads.length === 1 ? "is" : "are"} still open. Approve with suggestions to
          leave {myOpenThreads.length === 1 ? "it" : "them"} on the record without blocking the
          pull request.
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
