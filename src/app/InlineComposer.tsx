import * as React from "react";
import type { DiffSelection } from "../components/DiffViewer";
import { MarkdownCommentEditor } from "../components/MarkdownCommentEditor";
import { usePendingAction } from "./usePendingAction";

export interface InlineComposerProps {
  anchor: DiffSelection | undefined;
  onCancel: () => void;
  onSubmit: (content: string) => Promise<void>;
}

/** The editor for a new thread, mounted in the diff at the anchored line. */
export function InlineComposer({
  anchor,
  onCancel,
  onSubmit,
}: InlineComposerProps): React.ReactElement {
  const [value, setValue] = React.useState("");
  const { pending, error, run } = usePendingAction("Unable to create the comment.");

  const submit = (): Promise<void> =>
    run(async () => {
      await onSubmit(value.trim());
      setValue("");
    });

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
        onChange={setValue}
        onCancel={onCancel}
        onSubmit={() => void submit()}
      />
    </article>
  );
}
