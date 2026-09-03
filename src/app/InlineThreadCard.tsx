import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Markdown } from "../components/Markdown";
import { MarkdownCommentEditor } from "../components/MarkdownCommentEditor";
import { buildThreadShareLink } from "../core/shareLink";
import {
  replyToThread,
  setCommentLiked,
  setThreadResolved,
  updateCommentContent,
  type PullRequestWorkspace,
  type ReviewThread,
} from "../platform/azureDevOpsClient";
import { copyText } from "../platform/clipboard";
import { getTabContributionId } from "../platform/extensionContext";
import { getPullRequestPageUrl } from "../platform/pullRequestUrl";
import { formatDate } from "./formatDate";
import { usePendingAction } from "./usePendingAction";

export interface InlineThreadCardProps {
  workspace: PullRequestWorkspace;
  thread: ReviewThread;
  reviewerId: string;
  selected: boolean;
  /** The comment a share link named, so it can announce itself once. */
  highlightedCommentId?: number;
  onSelect: (threadId: number) => void;
  /** The highlight has played out; it must not play again on the next render. */
  onHighlightShown: () => void;
  onCollapse: () => void;
  /**
   * The thread was resolved or reopened. Whether its card stays on screen is
   * the workspace's call, not this card's: resolving one is how a reader says
   * they are done with it.
   */
  onResolvedChange: () => void;
  onRefresh: () => Promise<unknown>;
}

/**
 * A thread rendered inside the diff. It owns its own pending and error state so
 * a failed reply never blanks the whole review, and its React state survives a
 * refresh because the view zone keeps its key.
 */
export function InlineThreadCard({
  workspace,
  thread,
  reviewerId,
  selected,
  highlightedCommentId,
  onSelect,
  onHighlightShown,
  onCollapse,
  onResolvedChange,
  onRefresh,
}: InlineThreadCardProps): React.ReactElement {
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [editingCommentId, setEditingCommentId] = React.useState<number>();
  const [editText, setEditText] = React.useState("");
  const { pending, error, run } = usePendingAction("Unable to update this comment.");
  const share = useShareLink(workspace, thread);

  // Every action here writes a comment, so the threads are always re-read after
  // it: the card shows what Azure DevOps stored rather than what was typed.
  const runAndRefresh = (action: () => Promise<void>): Promise<void> =>
    run(async () => {
      await action();
      await onRefresh();
    });

  // The reply is written first and the thread closed after it, so a failure on
  // the second call leaves the comment posted rather than losing what was typed.
  const submitReply = (thenToggleState: boolean): Promise<void> =>
    runAndRefresh(async () => {
      await replyToThread(workspace, thread.id, replyText.trim());
      if (thenToggleState) {
        await setThreadResolved(workspace, thread.id, thread.isOpen);
        onResolvedChange();
      }
      setReplyText("");
      setReplyOpen(false);
    });

  const anchorLabel = thread.position
    ? `${thread.position.side === "left" ? "Base" : "Changed"} · line ${thread.position.startLine}`
    : "File comment";

  return (
    <article
      className={selected ? "inline-thread selected" : "inline-thread"}
      onClick={() => onSelect(thread.id)}
    >
      <header>
        <span className={thread.isOpen ? "thread-state open" : "thread-state resolved"} />
        <strong>{thread.isOpen ? "Open" : "Resolved"}</strong>
        <span className="inline-thread-anchor">{anchorLabel}</span>
        <Button
          subtle
          iconProps={{ iconName: "ChevronUp" }}
          ariaLabel="Collapse this comment"
          tooltipProps={{ text: "Collapse. Reopen it from the comment icon in the margin" }}
          onClick={onCollapse}
        />
      </header>
      <div className="inline-thread-comments">
        {thread.comments.map((comment) => {
          const likedByMe = comment.likedBy.includes(reviewerId);

          return (
            <section key={comment.id}>
              <div
                className={
                  comment.id === highlightedCommentId
                    ? "inline-comment-meta linked"
                    : "inline-comment-meta"
                }
                // The class is dropped when the animation ends rather than on a
                // timer: the card is mounted by Monaco, which may happen well
                // after the link was followed, and a blink nobody saw is a blink
                // that did not happen.
                onAnimationEnd={onHighlightShown}
              >
                <strong>{comment.authorName}</strong>
                <time dateTime={comment.publishedDate}>{formatDate(comment.publishedDate)}</time>
                {/* The icons are grouped so they can sit against each other: the
                    row's gap belongs between name, date and commands, not inside
                    what reads as one strip. Unlike editing, sharing is offered on
                    every comment and to everyone. */}
                <span className="inline-comment-actions">
                  {comment.authorId === reviewerId && editingCommentId !== comment.id && (
                    <Button
                      subtle
                      iconProps={{ iconName: "Edit" }}
                      ariaLabel="Edit this comment"
                      tooltipProps={{ text: "Edit" }}
                      disabled={pending}
                      onClick={() => {
                        setEditingCommentId(comment.id);
                        setEditText(comment.content);
                      }}
                    />
                  )}
                  {/* Azure DevOps records a like on a comment, so every reply
                      carries its own: the count in the file tree is the one on the
                      comment that opened the discussion. */}
                  <Button
                    subtle
                    iconProps={{ iconName: likedByMe ? "LikeSolid" : "Like" }}
                    ariaLabel={`${likedByMe ? "Remove like" : "Like"}, ${comment.likeCount} so far`}
                    tooltipProps={{
                      text: `${likedByMe ? "Remove like" : "Like"} (${comment.likeCount})`,
                    }}
                    disabled={pending}
                    onClick={(event) => {
                      event.stopPropagation();
                      void runAndRefresh(() =>
                        setCommentLiked(workspace, thread.id, comment.id, !likedByMe),
                      );
                    }}
                  />
                  <Button
                    subtle
                    iconProps={{
                      iconName: share.copiedFrom === comment.id ? "CheckMark" : "Link",
                    }}
                    ariaLabel="Copy a link to this comment"
                    tooltipProps={{
                      text:
                        share.copiedFrom === comment.id
                          ? "Link copied"
                          : "Copy a link that opens this comment in Guided Review",
                    }}
                    onClick={(event) => {
                      // The card selects the thread on click; sharing is about
                      // this one comment and must not move the diff under the
                      // reader.
                      event.stopPropagation();
                      void share.copy(comment.id);
                    }}
                  />
                  {/* Announced as well as shown: an icon swapping to a tick is
                      not something a screen reader reports on its own. */}
                  {share.copiedFrom === comment.id && (
                    <span className="inline-comment-copied" role="status">
                      Link copied
                    </span>
                  )}
                </span>
              </div>
              {editingCommentId === comment.id ? (
                <MarkdownCommentEditor
                  value={editText}
                  disabled={pending}
                  submitLabel="Save"
                  placeholder="Edit your comment"
                  autoFocus
                  onChange={setEditText}
                  onCancel={() => setEditingCommentId(undefined)}
                  onSubmit={() =>
                    void runAndRefresh(async () => {
                      await updateCommentContent(
                        workspace,
                        thread.id,
                        comment.id,
                        editText.trim(),
                      );
                      setEditingCommentId(undefined);
                    })
                  }
                />
              ) : (
                <Markdown content={comment.content} />
              )}
            </section>
          );
        })}
      </div>
      {error && <p className="inline-thread-error">{error}</p>}
      {share.error && <p className="inline-thread-error">{share.error}</p>}
      {/* Hidden while the composer is open: it offers the same actions, and a
          row kept here would cost the view zone height for nothing. */}
      {!replyOpen && (
        <div className="inline-thread-actions">
          <Button text="Reply" disabled={pending} onClick={() => setReplyOpen((open) => !open)} />
          <Button
            text={thread.isOpen ? "Resolve" : "Reopen"}
            primary={thread.isOpen}
            disabled={pending}
            onClick={() =>
              void runAndRefresh(async () => {
                await setThreadResolved(workspace, thread.id, thread.isOpen);
                onResolvedChange();
              })
            }
          />
        </div>
      )}
      {replyOpen && (
        <MarkdownCommentEditor
          value={replyText}
          disabled={pending}
          submitLabel="Reply"
          placeholder="Write a reply"
          autoFocus
          // Resolving is offered beside the reply, not instead of it: the last
          // word on a discussion and closing it are usually the same intent,
          // and doing it in two round-trips means two refreshes.
          secondaryAction={{
            label: thread.isOpen ? "Reply & resolve" : "Reply & reopen",
            onClick: () => void submitReply(true),
          }}
          onChange={setReplyText}
          onCancel={() => {
            setReplyOpen(false);
            setReplyText("");
          }}
          onSubmit={() => void submitReply(false)}
        />
      )}
    </article>
  );
}

/**
 * Copying a link to this thread, and the short-lived confirmation that says it
 * worked. The link is built on demand: the pull request page has to be resolved
 * against the host, and nothing should be asked of it until someone shares.
 */
function useShareLink(workspace: PullRequestWorkspace, thread: ReviewThread) {
  // Which comment's icon was clicked, so the confirmation stays on that row
  // rather than on every one of them: the link is the same, the gesture is not.
  const [copiedFrom, setCopiedFrom] = React.useState<number>();
  const [error, setError] = React.useState<string>();

  // The confirmation is the only thing that says the copy happened, so it goes
  // away on its own rather than staying until the card is clicked again.
  React.useEffect(() => {
    if (copiedFrom === undefined) {
      return;
    }

    const timer = window.setTimeout(() => setCopiedFrom(undefined), 2000);
    return () => window.clearTimeout(timer);
  }, [copiedFrom]);

  const copy = async (commentId: number): Promise<void> => {
    setError(undefined);
    const tabId = getTabContributionId();
    const pullRequestUrl = await getPullRequestPageUrl(workspace);
    if (!tabId || !pullRequestUrl || !thread.filePath) {
      setError("Unable to build a link to this comment.");
      return;
    }

    const link = buildThreadShareLink({
      pullRequestUrl,
      tabId,
      filePath: thread.filePath,
      threadId: thread.id,
      commentId,
    });
    if (await copyText(link)) {
      setCopiedFrom(commentId);
      return;
    }

    // Shown in full so it can still be copied by hand: the clipboard is the
    // convenience, the link is the point.
    setError(`Copying failed; the link is ${link}`);
  };

  return { copiedFrom, error, copy };
}
