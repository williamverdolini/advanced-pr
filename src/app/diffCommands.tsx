import * as React from "react";
import type { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { DiffLayoutSwitch } from "./DiffLayoutSwitch";
import { DiffNavigation } from "./DiffNavigation";

export interface DiffCommandsInput {
  /** A file that exists on one side only has no sides to lay out. */
  contentOnly: boolean;
  contentSide: "left" | "right";
  sideBySide: boolean;
  /** Only known once Monaco's worker has compared the two sides. */
  differenceCount: number;
  onSideBySideChange: (sideBySide: boolean) => void;
  onGoToDifference: (direction: "next" | "previous") => void;
}

/**
 * The file commands, rendered in the card header on the title's line: in the
 * card content they would cost a row of height on every file.
 */
export function buildDiffCommands({
  contentOnly,
  contentSide,
  sideBySide,
  differenceCount,
  onSideBySideChange,
  onGoToDifference,
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
      id: "difference-navigation",
      text: "Differences",
      renderButton: () => (
        <DiffNavigation
          key="difference-navigation"
          differenceCount={differenceCount}
          onGoToDifference={onGoToDifference}
        />
      ),
    },
  ];
}
