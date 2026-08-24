import * as React from "react";
import { Checkbox } from "azure-devops-ui/Checkbox";
import type { IHeaderCommandBarItem } from "azure-devops-ui/HeaderCommandBar";
import { diffCommandSpecs, type DiffCommandId } from "../core/diffCommands";
import type { DiffViewMode } from "../core/diffViewMode";
import { DiffNavigation } from "./DiffNavigation";
import { DiffViewModePicker } from "./DiffViewModePicker";
import { DiffViewOptions } from "./DiffViewOptions";

export interface DiffCommandsInput {
  viewMode: DiffViewMode;
  /** The modes the open file can be shown in. */
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
 *
 * Which commands appear, in which order, and the `important` flag that keeps
 * each of them a button rather than an entry in the `...` menu, all come from
 * `core/diffCommands`. This file only says how each one is drawn.
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
  const renderers: Record<DiffCommandId, () => React.ReactElement> = {
    "diff-view-mode": () => (
      <DiffViewModePicker
        key="diff-view-mode"
        mode={viewMode}
        modes={viewModes}
        onChange={onViewModeChange}
      />
    ),
    "diff-view-options": () => (
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
    viewed: () => (
      <Checkbox
        key="viewed"
        className="diff-toolbar-viewed"
        label="Viewed"
        checked={viewed}
        onChange={(_event, checked) => onViewedChange(checked)}
      />
    ),
    "difference-navigation": () => (
      <DiffNavigation
        key="difference-navigation"
        differenceCount={differenceCount}
        onGoToDifference={onGoToDifference}
      />
    ),
  };

  return diffCommandSpecs({ viewMode, viewModes }).map((spec) => ({
    ...spec,
    renderButton: renderers[spec.id],
  }));
}
