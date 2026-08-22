import * as React from "react";
import { Checkbox } from "azure-devops-ui/Checkbox";
import type { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { DiffLayoutSwitch } from "./DiffLayoutSwitch";
import { DiffNavigation } from "./DiffNavigation";

export interface DiffCommandsInput {
  /** A file that exists on one side only has no sides to lay out. */
  contentOnly: boolean;
  /** False where the width admits one layout only, and the choice is not real. */
  layoutSwitch: boolean;
  sideBySide: boolean;
  /** Only known once Monaco's worker has compared the two sides. */
  differenceCount: number;
  /** Whether the open file is marked as viewed, the same mark the tree shows. */
  viewed: boolean;
  onViewedChange: (viewed: boolean) => void;
  onSideBySideChange: (sideBySide: boolean) => void;
  onGoToDifference: (direction: "next" | "previous") => void;
}

/**
 * The file commands, rendered in the card header on the title's line: in the
 * card content they would cost a row of height on every file.
 */
export function buildDiffCommands({
  contentOnly,
  layoutSwitch,
  sideBySide,
  differenceCount,
  viewed,
  onViewedChange,
  onSideBySideChange,
  onGoToDifference,
}: DiffCommandsInput): IHeaderCommandBarItem[] {
  return [
    // A file that exists on one side has no layout to choose, and said so in a
    // line of prose that cost the file name half the header. The change is on
    // the name itself now: struck through when it is gone, badged otherwise.
    ...(contentOnly || !layoutSwitch
      ? []
      : [
          {
            id: "diff-layout",
            text: "Diff layout",
            renderButton: () => (
              <DiffLayoutSwitch
                key="diff-layout"
                sideBySide={sideBySide}
                onChange={onSideBySideChange}
              />
            ),
          },
        ]),
    {
      // Beside the file name, where the file is: marking it read is about what
      // is on screen, and reaching into the tree to do it means leaving it.
      id: "viewed",
      text: "Viewed",
      renderButton: () => (
        <Checkbox
          key="viewed"
          className="diff-toolbar-viewed"
          label="Viewed"
          checked={viewed}
          onChange={(_event, checked) => onViewedChange(checked)}
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
