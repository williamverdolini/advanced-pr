import * as React from "react";
import { MenuButton } from "azure-devops-ui/Menu";
import type { DiffViewMode } from "../core/diffViewMode";

export interface DiffViewModePickerProps {
  mode: DiffViewMode;
  /** Only the modes the open file can be shown in; never empty. */
  modes: readonly DiffViewMode[];
  onChange: (mode: DiffViewMode) => void;
}

const modeText: Record<DiffViewMode, string> = {
  inline: "Inline",
  sideBySide: "Side by side",
  preview: "Preview",
};

const modeIcon: Record<DiffViewMode, string> = {
  inline: "DiffInline",
  sideBySide: "DiffSideBySide",
  preview: "Preview",
};

/**
 * How the open file is rendered. A menu rather than the pair of buttons it
 * replaces: Markdown adds a third choice, and the header shares its one line
 * with the file name, the viewed mark and the difference arrows.
 */
export function DiffViewModePicker({
  mode,
  modes,
  onChange,
}: DiffViewModePickerProps): React.ReactElement {
  return (
    <MenuButton
      subtle
      className="diff-view-mode"
      iconProps={{ iconName: modeIcon[mode] }}
      text={modeText[mode]}
      ariaLabel="Choose how the file is shown"
      contextualMenuProps={{
        onActivate: (menuItem) => onChange(menuItem.id as DiffViewMode),
        menuProps: {
          id: "advanced-pr-diff-view-mode",
          items: modes.map((candidate) => ({
            id: candidate,
            text: modeText[candidate],
            iconProps: { iconName: modeIcon[candidate] },
            // Read-only state marks the current mode with a checkmark; a
            // writable one would render a checkbox, which reads as three
            // independent switches rather than one choice among three. It also
            // keeps the menu closing on a pick, which the writable kind does
            // not: an item that owns its state is handled without dismissing.
            checked: candidate === mode,
            readonly: true,
          })),
        },
      }}
    />
  );
}
