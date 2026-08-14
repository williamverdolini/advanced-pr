import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Callout } from "azure-devops-ui/Callout";
import { IconSize } from "azure-devops-ui/Icon";
import { Location } from "azure-devops-ui/Utilities/Position";
import { MentionContext } from "../components/mentionContext";
import type { StepDecision } from "../core/ledger";
import { formatDate } from "./formatDate";

export interface StepDecisionsProps {
  stepTitle: string;
  /** In the order the ledger recorded them, which is the order they happened. */
  decisions: readonly StepDecision[];
  /** To mark this reviewer's own decision in the list. */
  reviewerId: string;
}

/**
 * Who has decided on a step, on demand. The step number already says what *this*
 * reviewer decided; on a pull request with several reviewers it says nothing
 * about the others, and the ledger knows.
 */
export function StepDecisions({
  stepTitle,
  decisions,
  reviewerId,
}: StepDecisionsProps): React.ReactElement | null {
  const anchor = React.useRef<HTMLSpanElement>(null);
  // The element the callout hangs off is held in state, not read from the ref
  // while rendering: the click that opens the panel is where a ref may be read,
  // and the open state and the anchor are then one value instead of two that
  // could disagree.
  const [anchored, setAnchored] = React.useState<HTMLElement>();
  // The directory the mentions already build: a decision carries the Azure
  // DevOps identity id of the comment author, and every ledger comment is one of
  // the threads that directory is assembled from, so the name is in hand.
  const resolveIdentity = React.useContext(MentionContext);

  // Nothing to open on a step nobody has decided on, and no button either: an
  // affordance on every step would say "look here" thirty times over.
  if (decisions.length === 0) {
    return null;
  }

  const approved = decisions.filter((decision) => decision.status === "approved").length;
  const summary = `${approved} of ${decisions.length} approved`;

  return (
    <span className="step-decisions" ref={anchor}>
      <Button
        subtle
        className="step-decisions-button"
        iconProps={{ iconName: "People", size: IconSize.small }}
        ariaLabel={`Who decided on ${stepTitle}: ${summary}`}
        ariaExpanded={Boolean(anchored)}
        tooltipProps={{ text: `Who decided on this step (${summary})` }}
        onClick={() => setAnchored(anchored ? undefined : (anchor.current ?? undefined))}
      />
      {anchored && (
        <Callout
          anchorElement={anchored}
          anchorOrigin={{ horizontal: Location.center, vertical: Location.end }}
          calloutOrigin={{ horizontal: Location.center, vertical: Location.start }}
          ariaLabel={`Decisions on ${stepTitle}`}
          contentShadow
          escDismiss
          lightDismiss
          onDismiss={() => setAnchored(undefined)}
        >
          <div className="step-decisions-panel">
            <p className="step-decisions-title">{stepTitle}</p>
            <ul>
              {decisions.map((decision) => (
                <li key={decision.reviewerId}>
                  <span className={`step-decisions-state ${decision.status}`} />
                  <span className="step-decisions-name">
                    {resolveIdentity?.(decision.reviewerId)?.displayName ?? decision.reviewerId}
                    {decision.reviewerId === reviewerId && <em> (you)</em>}
                  </span>
                  <time className="step-decisions-date" dateTime={decision.publishedDate}>
                    {formatDate(decision.publishedDate)}
                  </time>
                </li>
              ))}
            </ul>
          </div>
        </Callout>
      )}
    </span>
  );
}
