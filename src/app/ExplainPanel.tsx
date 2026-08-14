import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { IconSize } from "azure-devops-ui/Icon";
import { Markdown } from "../components/Markdown";

export interface ExplainPanelProps {
  stepTitle: string;
  explanation: string;
  onExpand: () => void;
}

/** The author's notes for the selected step, above its file list. */
export function ExplainPanel({
  stepTitle,
  explanation,
  onExpand,
}: ExplainPanelProps): React.ReactElement {
  return (
    <details className="explain-panel" open>
      <summary>
        <span className="explain-title">Explain</span>
        <span className="explain-step">{stepTitle}</span>
        <Button
          subtle
          className="explain-expand"
          iconProps={{ iconName: "FullScreen", size: IconSize.small }}
          ariaLabel="Read the explanation in a larger view"
          tooltipProps={{ text: "Expand" }}
          onClick={(event) => {
            // The button lives inside <summary>, whose default action is to
            // collapse the panel underneath it.
            event.preventDefault();
            event.stopPropagation();
            onExpand();
          }}
        />
      </summary>
      <Markdown className="explain-body" content={explanation} />
    </details>
  );
}
