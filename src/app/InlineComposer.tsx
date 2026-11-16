import * as React from "react";
import type { DiffSelection } from "../components/DiffViewer";
import { MarkdownCommentEditor } from "../components/MarkdownCommentEditor";
import { usePendingAction } from "./usePendingAction";

export interface InlineComposerProps {
  anchor: DiffSelection | undefined;
  /** Held by the workspace, so the text outlives the composer. */
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: (content: string) => Promise<void>;
}

/** The editor for a new thread, mounted in the diff at the anchored line. */
export function InlineComposer({
  anchor,
  value,
  onChange,
  onCancel,
  onSubmit,
}: InlineComposerProps): React.ReactElement {
  const { pending, error, run } = usePendingAction("Unable to create the comment.");

  const submit = (): Promise<void> =>
    run(() => onSubmit(value.trim()));

  return (
    <article className="inline-thread inline-composer">
      <header>
        <strong>New comment</strong>
        <span className="inline-thread-anchor">
          {anchor
            ? anchor.startLine === anchor.endLine
              ? `Line ${anchor.startLine}`
              : `Lines ${anchor.startLine}–${anchor.endLine}`
            : ""}
        </span>
      </header>
      {error && <p className="inline-thread-error">{error}</p>}
      <MarkdownCommentEditor
        value={value}
        disabled={pending}
        submitLabel="Comment"
        placeholder="Write a comment on this code"
        autoFocus
        onChange={onChange}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
    </article>
  );
}
