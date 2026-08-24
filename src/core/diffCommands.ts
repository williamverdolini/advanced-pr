import type { DiffViewMode } from "./diffViewMode";

export type DiffCommandId =
  | "diff-view-mode"
  | "diff-view-options"
  | "viewed"
  | "difference-navigation";

export interface DiffCommandSpec {
  readonly id: DiffCommandId;
  /** The command's name, for assistive technology and for a tooltip. */
  readonly text: string;
  /**
   * Always true, and typed as the literal so it cannot be turned off one
   * command at a time.
   *
   * `HeaderCommandBar` renders three buttons and pushes the rest into its `...`
   * menu, where an item is rebuilt from its `text` and its `onActivate`. Every
   * command here is a custom control instead — a menu, a checkbox, a pair of
   * arrows — handed over as `renderButton`, which the overflow menu ignores. An
   * overflowed command therefore becomes a line of text that does nothing,
   * which is exactly what happened to the difference arrows when the fourth
   * command was added. `Card` exposes no way to raise that count, so the
   * commands opt out of the overflow instead.
   */
  readonly important: true;
}

export interface DiffCommandsContext {
  readonly viewMode: DiffViewMode;
  /** The modes the open file can be shown in, from `availableDiffViewModes`. */
  readonly viewModes: readonly DiffViewMode[];
}

/**
 * Which commands the diff card's header carries, in the order it shows them.
 * The header is built from this list, so a command missing here is a command
 * that is not on screen.
 */
export function diffCommandSpecs({
  viewMode,
  viewModes,
}: DiffCommandsContext): readonly DiffCommandSpec[] {
  // Rendered prose has no lines to wrap, no whitespace to reveal and no
  // differences to step through: what is on screen is not the file's text.
  const showingDiff = viewMode !== "preview";

  const specs: DiffCommandSpec[] = [];

  // A file with one mode has no choice to offer.
  if (viewModes.length > 1) {
    specs.push({ id: "diff-view-mode", text: "View mode", important: true });
  }
  if (showingDiff) {
    specs.push({ id: "diff-view-options", text: "View settings", important: true });
  }
  // Beside the file name, where the file is: marking it read is about what is on
  // screen, and reaching into the tree to do it means leaving it.
  specs.push({ id: "viewed", text: "Viewed", important: true });
  if (showingDiff) {
    specs.push({ id: "difference-navigation", text: "Differences", important: true });
  }

  return specs;
}
