import * as React from "react";
import { Button } from "azure-devops-ui/Button";

export interface PlanEditorProps {
  value: string;
  /** No plan yet: the action creates one rather than revising it. */
  isNewPlan: boolean;
  pending: boolean;
  reviewClosed: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function PlanEditor({
  value,
  isNewPlan,
  pending,
  reviewClosed,
  onChange,
  onSave,
  onCancel,
}: PlanEditorProps): React.ReactElement {
  return (
    <div className="plan-editor toolbar-plan-editor">
      <textarea
        aria-label="Review plan Markdown"
        value={value}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
      />
      <div className="plan-editor-actions">
        <Button
          text={isNewPlan ? "Create plan" : "Save new version"}
          primary
          disabled={pending || reviewClosed || !value.trim()}
          onClick={onSave}
        />
        <Button text="Cancel" disabled={pending} onClick={onCancel} />
      </div>
    </div>
  );
}
