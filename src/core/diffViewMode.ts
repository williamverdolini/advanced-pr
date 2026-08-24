import { languageForPath } from "./language";

/** How the open file is rendered: as a diff, or as the content it holds. */
export type DiffViewMode = "inline" | "sideBySide" | "preview";

export interface DiffViewContext {
  path: string;
  /** A file that exists on one side only has no second side to lay out. */
  contentOnly: boolean;
  /** Two columns of code do not fit on a narrow screen, whatever is chosen. */
  narrow: boolean;
}

/**
 * The modes the open file can actually be shown in, in the order the picker
 * lists them. Inline is always among them: it is the one mode every file has,
 * which is what makes it the fallback below.
 */
export function availableDiffViewModes({
  path,
  contentOnly,
  narrow,
}: DiffViewContext): readonly DiffViewMode[] {
  const modes: DiffViewMode[] = ["inline"];

  if (!contentOnly && !narrow) {
    modes.push("sideBySide");
  }
  // Rendered prose only means something for prose. The language is already
  // derived from the extension for Monaco, so this asks it rather than keeping
  // a second list of Markdown extensions in step with the first.
  if (languageForPath(path) === "markdown") {
    modes.push("preview");
  }

  return modes;
}

/**
 * The mode to render with, given what the reader last asked for. The choice
 * outlives the file it was made on: moving from a Markdown file to a `.ts` one,
 * or narrowing the window, must not leave the viewer on a mode the file has no
 * way to show. The request itself is kept, so going back to Markdown comes back
 * to the preview.
 */
export function resolveDiffViewMode(
  requested: DiffViewMode,
  available: readonly DiffViewMode[],
): DiffViewMode {
  return available.includes(requested) ? requested : "inline";
}
