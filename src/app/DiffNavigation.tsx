import * as React from "react";
import { Icon, IconSize } from "azure-devops-ui/Icon";

export interface DiffNavigationProps {
  /** Zero until Monaco's worker has compared the two sides. */
  differenceCount: number;
  onGoToDifference: (direction: "next" | "previous") => void;
}

/** Walks a file by change rather than by scrolling. */
export function DiffNavigation({
  differenceCount,
  onGoToDifference,
}: DiffNavigationProps): React.ReactElement {
  const disabled = differenceCount === 0;
  const reason = disabled ? "No differences to move through" : undefined;

  return (
    <div className="diff-segmented" role="group" aria-label="Differences">
      {(["previous", "next"] as const).map((direction) => {
        const label = `${direction === "next" ? "Next" : "Previous"} difference`;
        return (
          <button
            key={direction}
            type="button"
            className="icon-only"
            aria-label={label}
            title={reason ?? label}
            disabled={disabled}
            onClick={() => onGoToDifference(direction)}
          >
            {/* The library's Icon renders the `fluent-icons-enabled` wrapper its
                own font rules require; a bare class name would not resolve. */}
            <Icon iconName={direction === "next" ? "Down" : "Up"} size={IconSize.small} />
          </button>
        );
      })}
    </div>
  );
}
