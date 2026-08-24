import * as React from "react";
import { MenuButton } from "azure-devops-ui/Menu";

export interface DiffViewOptionsProps {
  /** Renders space and tab glyphs, and stops the diff ignoring trimmed space. */
  showWhitespace: boolean;
  wordWrap: boolean;
  /** False where word wrap is imposed by the width and the switch would lie. */
  wordWrapChoosable: boolean;
  /** The enclosing scopes pinned above the code as it scrolls. */
  stickyScroll: boolean;
  onShowWhitespaceChange: (showWhitespace: boolean) => void;
  onWordWrapChange: (wordWrap: boolean) => void;
  onStickyScrollChange: (stickyScroll: boolean) => void;
}

/**
 * The two rendering switches the official Files tab keeps behind the same
 * icon, in the same place, so a reader who knows that tab does not have to look
 * for them here. Both are per-view, not per-file: a reader who wants to see
 * whitespace wants to see it in the next file too.
 */
export function DiffViewOptions({
  showWhitespace,
  wordWrap,
  wordWrapChoosable,
  stickyScroll,
  onShowWhitespaceChange,
  onWordWrapChange,
  onStickyScrollChange,
}: DiffViewOptionsProps): React.ReactElement {
  return (
    <MenuButton
      subtle
      hideDropdownIcon
      className="diff-view-options"
      iconProps={{ iconName: "Equalizer" }}
      ariaLabel="Diff view settings"
      tooltipProps={{ text: "View settings" }}
      contextualMenuProps={{
        menuProps: {
          id: "advanced-pr-diff-view-options",
          // Writable state, so each entry is a checkbox that toggles where it
          // stands: the menu is not dismissed, which is what lets both switches
          // be set in one visit. The handler therefore lives on the item, since
          // an item owning its state never reaches the menu's `onActivate`.
          items: [
            {
              id: "show-whitespace",
              text: "Show and diff white space",
              checked: showWhitespace,
              onActivate: () => onShowWhitespaceChange(!showWhitespace),
            },
            {
              id: "word-wrap",
              text: "Enable word wrap",
              checked: wordWrap,
              // Narrow screens wrap regardless: horizontal scrolling there is
              // the difference between reading the code and hunting for it.
              disabled: !wordWrapChoosable,
              onActivate: () => onWordWrapChange(!wordWrap),
            },
            {
              id: "sticky-scroll",
              text: "Keep enclosing scopes on screen",
              checked: stickyScroll,
              onActivate: () => onStickyScrollChange(!stickyScroll),
            },
          ],
        },
      }}
    />
  );
}
