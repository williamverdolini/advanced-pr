import * as React from "react";
import { Checkbox } from "azure-devops-ui/Checkbox";
import type { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import type { DiffViewMode } from "../core/diffViewMode";
import { DiffNavigation } from "./DiffNavigation";
import { DiffViewModePicker } from "./DiffViewModePicker";
import { DiffViewOptions } from "./DiffViewOptions";

export interface DiffCommandsInput {
  viewMode: DiffViewMode;
  /** The modes the open file can be shown in, from `core/diffViewMode`. */
  viewModes: readonly DiffViewMode[];
  /** Only known once Monaco's worker has compared the two sides. */
  differenceCount: number;
  /** Whether the open file is marked as viewed, the same mark the tree shows. */
  viewed: boolean;
  showWhitespace: boolean;
  wordWrap: boolean;
  /** False where the width imposes word wrap and the switch would lie. */
  wordWrapChoosable: boolean;
  stickyScroll: boolean;
  onViewedChange: (viewed: boolean) => void;
  onViewModeChange: (mode: DiffViewMode) => void;
  onShowWhitespaceChange: (showWhitespace: boolean) => void;
  onWordWrapChange: (wordWrap: boolean) => void;
  onStickyScrollChange: (stickyScroll: boolean) => void;
  onGoToDifference: (direction: "next" | "previous") => void;
}

/**
 * The file commands, rendered in the card header on the title's line: in the
 * card content they would cost a row of height on every file.
 */
export function buildDiffCommands({
  viewMode,
  viewModes,
  differenceCount,
  viewed,
  showWhitespace,
  wordWrap,
  wordWrapChoosable,
  stickyScroll,
  onViewedChange,
  onViewModeChange,
  onShowWhitespaceChange,
  onWordWrapChange,
  onStickyScrollChange,
  onGoToDifference,
}: DiffCommandsInput): IHeaderCommandBarItem[] {
  // Rendered prose has no lines to wrap, no whitespace to reveal and no
  // differences to step through: what is on screen is not the file's text.
  const showingDiff = viewMode !== "preview";

  return [
    // A file with one mode has no choice to offer, and said so in a line of
    // prose that cost the file name half the header. The change is on the name
    // itself now: struck through when it is gone, badged otherwise.
    ...(viewModes.length < 2
      ? []
      : [
          {
            id: "diff-view-mode",
            text: "View mode",
            renderButton: () => (
              <DiffViewModePicker
                key="diff-view-mode"
                mode={viewMode}
                modes={viewModes}
                onChange={onViewModeChange}
              />
            ),
          },
        ]),
    ...(showingDiff
      ? [
          {
            id: "diff-view-options",
            text: "View settings",
            renderButton: () => (
              <DiffViewOptions
                key="diff-view-options"
                showWhitespace={showWhitespace}
                wordWrap={wordWrap}
                wordWrapChoosable={wordWrapChoosable}
                stickyScroll={stickyScroll}
                onShowWhitespaceChange={onShowWhitespaceChange}
                onWordWrapChange={onWordWrapChange}
                onStickyScrollChange={onStickyScrollChange}
              />
            ),
          },
        ]
      : []),
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
    ...(showingDiff
      ? [
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
        ]
      : []),
  ];
}
