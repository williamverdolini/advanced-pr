import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { TextField } from "azure-devops-ui/TextField";
import { Markdown } from "./Markdown";

export interface MarkdownCommentEditorProps {
  value: string;
  disabled: boolean;
  submitLabel: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}

interface MarkdownAction {
  label: string;
  prefix: string;
  suffix?: string;
  placeholder: string;
}

const actions: MarkdownAction[] = [
  { label: "B", prefix: "**", suffix: "**", placeholder: "bold text" },
  { label: "I", prefix: "_", suffix: "_", placeholder: "italic text" },
  { label: "Code", prefix: "`", suffix: "`", placeholder: "code" },
  { label: "Link", prefix: "[", suffix: "](https://)", placeholder: "link text" },
  { label: "Quote", prefix: "> ", placeholder: "quoted text" },
  { label: "List", prefix: "- ", placeholder: "list item" },
];

export function MarkdownCommentEditor({
  value,
  disabled,
  submitLabel,
  placeholder,
  onChange,
  onSubmit,
  onCancel,
}: MarkdownCommentEditorProps): React.ReactElement {
  const inputRef = React.useRef<HTMLTextAreaElement & HTMLInputElement>(null);

  const applyMarkdown = (action: MarkdownAction): void => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    const start = input.selectionStart ?? value.length;
    const end = input.selectionEnd ?? start;
    const selected = value.slice(start, end) || action.placeholder;
    const replacement = `${action.prefix}${selected}${action.suffix ?? ""}`;
    onChange(`${value.slice(0, start)}${replacement}${value.slice(end)}`);

    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + action.prefix.length, start + action.prefix.length + selected.length);
    });
  };

  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar" role="toolbar" aria-label="Comment formatting">
        {actions.map((action) => (
          <Button
            key={action.label}
            text={action.label}
            subtle
            disabled={disabled}
            tooltipProps={{ text: `Insert ${action.placeholder}` }}
            onClick={() => applyMarkdown(action)}
          />
        ))}
        <span className="markdown-hint">Azure DevOps Markdown</span>
      </div>
      <TextField
        ariaLabel={placeholder}
        className="markdown-input"
        inputElement={inputRef}
        multiline
        // Grows with the content instead of scrolling inside a fixed box; the
        // view zone follows through its ResizeObserver.
        autoAdjustHeight
        resizable
        rows={3}
        spellCheck
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(_event, nextValue) => onChange(nextValue)}
      />
      {value.trim() && (
        <section className="markdown-preview" aria-label="Comment preview">
          <p className="markdown-preview-label">Preview</p>
          <Markdown content={value} />
        </section>
      )}
      <div className="markdown-actions">
        <Button text={submitLabel} primary disabled={disabled || !value.trim()} onClick={onSubmit} />
        {onCancel && <Button text="Cancel" disabled={disabled} onClick={onCancel} />}
      </div>
    </div>
  );
}