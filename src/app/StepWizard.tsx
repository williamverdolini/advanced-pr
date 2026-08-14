import * as React from "react";
import type { StepDecision, StepReviewStatus } from "../core/ledger";
import type { ReviewStep } from "../core/reviewPlan";
import { StepDecisions } from "./StepDecisions";

const noDecisions: ReadonlyMap<string, StepDecision> = new Map();

export interface StepWizardProps {
  steps: readonly ReviewStep[];
  selectedStepId?: string;
  /** This reviewer's decision per step, which colours the step number. */
  statuses?: ReadonlyMap<string, StepReviewStatus>;
  /** Every reviewer's decision, keyed step then reviewer, read on demand. */
  decisions: ReadonlyMap<string, ReadonlyMap<string, StepDecision>>;
  reviewerId: string;
  viewedFiles: ReadonlySet<string>;
  onSelect: (step: ReviewStep) => void;
}

export function StepWizard({
  steps,
  selectedStepId,
  statuses,
  decisions,
  reviewerId,
  viewedFiles,
  onSelect,
}: StepWizardProps): React.ReactElement {
  return (
    <ol className="step-wizard" aria-label="Review steps">
      {steps.map((step, index) => {
        const status = statuses?.get(step.stepId);
        const viewedCount = step.files.filter((path) => viewedFiles.has(path)).length;
        return (
          <li
            className={selectedStepId === step.stepId ? "active" : undefined}
            key={step.stepId}
          >
            {/* The decisions button is a sibling, never a child: a button inside
                a button is invalid, and the step must stay clickable as a whole. */}
            <button type="button" className="step-button" onClick={() => onSelect(step)}>
              <span className={`step-index ${status ?? ""}`}>{index + 1}</span>
              <span className="step-label">{step.title}</span>
              <span className="step-count">{viewedCount}/{step.files.length}</span>
            </button>
            <StepDecisions
              stepTitle={step.title}
              decisions={[...(decisions.get(step.stepId) ?? noDecisions).values()]}
              reviewerId={reviewerId}
            />
          </li>
        );
      })}
    </ol>
  );
}
