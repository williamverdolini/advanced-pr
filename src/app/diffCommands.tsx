import * as React from "react";
import type { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { DiffLayoutSwitch } from "./DiffLayoutSwitch";

export interface DiffCommandsInput {
  /** A file that exists on one side only has no sides to lay out. */
  contentOnly: boolean;
  contentSide: "left" | "right";
  sideBySide: boolean;
  hasSelection: boolean;
  onSideBySideChange: (sideBySide: boolean) => void;
  onCommentOnSelection: () => void;
}

/**
 * The file commands, rendered in the card header on the title's line: in the
 * card content they would cost a row of height on every file.
 */
export function buildDiffCommands({
  contentOnly,
  contentSide,
  sideBySide,
  hasSelection,
  onSideBySideChange,
  onCommentOnSelection,
}: DiffCommandsInput): IHeaderCommandBarItem[] {
  return [
    {
      id: "diff-layout",
      text: "Diff layout",
      renderButton: () =>
        contentOnly ? (
          <span className="diff-toolbar-note" key="diff-layout">
            {contentSide === "left" ? "Deleted file: previous contents" : "New file: full contents"}
          </span>
        ) : (
          <DiffLayoutSwitch
            key="diff-layout"
            sideBySide={sideBySide}
            onChange={onSideBySideChange}
          />
        ),
    },
    {
      id: "comment-on-selection",
      text: "Comment on selection",
      iconProps: { iconName: "CommentAdd" },
      disabled: !hasSelection,
      important: true,
      tooltipProps: {
        text: hasSelection ? "Comment on the selected code" : "Select code in the file first",
      },
      onActivate: () => {
        onCommentOnSelection();
        return true;
      },
    },
  ];
}
