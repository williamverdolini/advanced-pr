import * as React from "react";

export interface DiffLayoutSwitchProps {
  sideBySide: boolean;
  onChange: (sideBySide: boolean) => void;
}

/** Inline or side by side, for a file that has two sides to show. */
export function DiffLayoutSwitch({
  sideBySide,
  onChange,
}: DiffLayoutSwitchProps): React.ReactElement {
  return (
    <div className="diff-layout-switch" role="group" aria-label="Diff layout">
      <button
        type="button"
        className={sideBySide ? undefined : "active"}
        aria-pressed={!sideBySide}
        onClick={() => onChange(false)}
      >
        Inline
      </button>
      <button
        type="button"
        className={sideBySide ? "active" : undefined}
        aria-pressed={sideBySide}
        onClick={() => onChange(true)}
      >
        Side by side
      </button>
    </div>
  );
}
