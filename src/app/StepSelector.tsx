import * as React from "react";
import { IconSize } from "azure-devops-ui/Icon";
import { MenuButton } from "azure-devops-ui/Menu";
import type { StepReviewStatus } from "../core/ledger";
import type { ReviewStep } from "../core/reviewPlan";

export interface StepSelectorProps {
  steps: readonly ReviewStep[];
  selectedStepId?: string;
  /** This reviewer's decision per step, which marks the entries in the menu. */
  statuses?: ReadonlyMap<string, StepReviewStatus>;
  viewedFiles: ReadonlySet<string>;
  onSelect: (step: ReviewStep) => void;
}

/**
 * The step wizard for a screen too narrow to hold it. The strip degrades badly
 * there: the titles shrink to one letter and the steps past the third are only
 * reachable by scrolling something that does not look scrollable. A menu shows
 * every step, with its full title, in the height of one button.
 *
 * What it drops is the row of reviewer avatars: whose decision is on which step
 * is a comparison, and a comparison needs the steps side by side.
 */
export function StepSelector({
  steps,
  selectedStepId,
  statuses,
  viewedFiles,
  onSelect,
}: StepSelectorProps): React.ReactElement {
  const selectedIndex = steps.findIndex((step) => step.stepId === selectedStepId);
  const selected = selectedIndex >= 0 ? steps[selectedIndex] : undefined;

  return (
    <MenuButton
      className="step-selector"
      // The same mark the numbered circle carries in the wizard, in the same
      // place: on a narrow screen the button is the only thing on screen that
      // can say whether this step is decided.
      iconProps={selected ? statusIcon(statuses?.get(selected.stepId)) : undefined}
      text={
        selected
          ? `${selectedIndex + 1}/${steps.length} · ${selected.title}`
          : `Steps (${steps.length})`
      }
      ariaLabel="Choose the review step"
      contextualMenuProps={{
        onActivate: (menuItem) => {
          const step = steps.find((candidate) => candidate.stepId === menuItem.id);
          if (step) {
            onSelect(step);
          }
        },
        menuProps: {
          id: "advanced-pr-step-selector",
          items: steps.map((step, index) => ({
            id: step.stepId,
            text: `${index + 1}. ${step.title}`,
            // The counter is the same one the strip shows on each step, and the
            // reason to move on or come back to it.
            subText: `${step.files.filter((path) => viewedFiles.has(path)).length}/${
              step.files.length
            } viewed`,
            iconProps: statusIcon(statuses?.get(step.stepId)),
          })),
        },
      }}
    />
  );
}

function statusIcon(status: StepReviewStatus | undefined): {
  iconName: string;
  className: string;
  size: IconSize;
} {
  const name =
    status === "approved"
      ? { iconName: "CompletedSolid", className: "feedback-icon feedback-icon-success" }
      : status === "changes-requested"
        ? { iconName: "AwayStatus", className: "feedback-icon feedback-icon-waiting" }
        : { iconName: "CircleRing", className: "feedback-icon feedback-icon-neutral" };
  return { ...name, size: IconSize.medium };
}
