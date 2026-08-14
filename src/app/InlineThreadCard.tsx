import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Markdown } from "../components/Markdown";
import { MarkdownCommentEditor } from "../components/MarkdownCommentEditor";
import {
  replyToThread,
  setCommentLiked,
  setThreadResolved,
  updateCommentContent,
  type PullRequestWorkspace,
  type ReviewThread,
} from "../platform/azureDevOpsClient";
import { formatDate } from "./formatDate";
import { usePendingAction } from "./usePendingAction";

export interface InlineThreadCardProps {
  workspace: PullRequestWorkspace;
  thread: ReviewThread;
  reviewerId: string;
  selected: boolean;
  onSelect: (threadId: number) => void;
  onCollapse: () => void;
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
  onSelect,
  onCollapse,
  onRefresh,
}: InlineThreadCardProps): React.ReactElement {
  const [replyOpen, setReplyOpen] = React.useState(false);
  const [replyText, setReplyText] = React.useState("");
  const [editingCommentId, setEditingCommentId] = React.useState<number>();
  const [editText, setEditText] = React.useState("");
  const { pending, error, run } = usePendingAction("Unable to update this comment.");

  // Every action here writes a comment, so the threads are always re-read after
  // it: the card shows what Azure DevOps stored rather than what was typed.
  const runAndRefresh = (action: () => Promise<void>): Promise<void> =>
    run(async () => {
      await action();
      await onRefresh();
    });

  const anchorLabel = thread.position
    ? `${thread.position.side === "left" ? "Base" : "Changed"} · line ${thread.position.startLine}`
    : "File comment";
  // Azure DevOps likes individual comments; the thread-level action targets the
  // one that opened the discussion, which is what the count in the tree shows.
  const rootComment = thread.comments[0];
  const likedByMe = rootComment?.likedBy.includes(reviewerId) ?? false;

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
        {thread.comments.map((comment) => (
          <section key={comment.id}>
            <div className="inline-comment-meta">
              <strong>{comment.authorName}</strong>
              <time dateTime={comment.publishedDate}>{formatDate(comment.publishedDate)}</time>
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
            </div>
            {editingCommentId === comment.id ? (
              <MarkdownCommentEditor
                value={editText}
                disabled={pending}
                submitLabel="Save"
                placeholder="Edit your comment"
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
        ))}
      </div>
      {error && <p className="inline-thread-error">{error}</p>}
      <div className="inline-thread-actions">
        <Button text="Reply" disabled={pending} onClick={() => setReplyOpen((open) => !open)} />
        <Button
          text={thread.isOpen ? "Resolve" : "Reopen"}
          primary={thread.isOpen}
          disabled={pending}
          onClick={() =>
            void runAndRefresh(() => setThreadResolved(workspace, thread.id, thread.isOpen))
          }
        />
        {rootComment && (
          <Button
            subtle
            iconProps={{ iconName: likedByMe ? "LikeSolid" : "Like" }}
            ariaLabel={`${likedByMe ? "Remove like" : "Like"}, ${rootComment.likeCount} so far`}
            tooltipProps={{
              text: `${likedByMe ? "Remove like" : "Like"} (${rootComment.likeCount})`,
            }}
            disabled={pending}
            onClick={() =>
              void runAndRefresh(() =>
                setCommentLiked(workspace, thread.id, rootComment.id, !likedByMe),
              )
            }
          />
        )}
      </div>
      {replyOpen && (
        <MarkdownCommentEditor
          value={replyText}
          disabled={pending}
          submitLabel="Reply"
          placeholder="Write a reply"
          onChange={setReplyText}
          onCancel={() => {
            setReplyOpen(false);
            setReplyText("");
          }}
          onSubmit={() =>
            void runAndRefresh(async () => {
              await replyToThread(workspace, thread.id, replyText.trim());
              setReplyText("");
              setReplyOpen(false);
            })
          }
        />
      )}
    </article>
  );
}
