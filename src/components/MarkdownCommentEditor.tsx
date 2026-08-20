import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { TextField } from "azure-devops-ui/TextField";
import {
  mergeMentionDirectory,
  toDisplayText,
  toStoredText,
} from "../core/mentionText";
import type { DirectoryIdentity } from "../platform/identityService";
import { Markdown } from "./Markdown";
import { MentionContext } from "./mentionContext";
import { MentionTypeahead } from "./MentionTypeahead";

export interface MarkdownCommentEditorProps {
  value: string;
  disabled: boolean;
  submitLabel: string;
  placeholder: string;
  /**
   * A second way to submit the same text, beside the primary one: replying and
   * resolving in one go, typically. Hidden when absent.
   */
  secondaryAction?: { label: string; onClick: () => void };
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel?: () => void;
}

interface MarkdownAction {
  id: string;
  iconName: string;
  label: string;
  prefix: string;
  suffix?: string;
  /**
   * Text to leave selected when nothing was selected. Without it the action
   * only inserts its prefix and leaves the caret after it, which is what the
   * mention needs: the typeahead has to open on an empty query.
   */
  placeholder?: string;
}

const actions: MarkdownAction[] = [
  { id: "bold", iconName: "SemiboldWeight", label: "Bold", prefix: "**", suffix: "**", placeholder: "bold text" },
  { id: "italic", iconName: "Italic", label: "Italic", prefix: "_", suffix: "_", placeholder: "italic text" },
  { id: "code", iconName: "Embed", label: "Code", prefix: "`", suffix: "`", placeholder: "code" },
  { id: "link", iconName: "Link", label: "Link", prefix: "[", suffix: "](https://)", placeholder: "link text" },
  { id: "bulleted", iconName: "BulletedList", label: "Bulleted list", prefix: "- ", placeholder: "list item" },
  { id: "numbered", iconName: "NumberedList", label: "Numbered list", prefix: "1. ", placeholder: "list item" },
  { id: "mention", iconName: "Accounts", label: "Mention someone", prefix: "@" },
];

export function MarkdownCommentEditor({
  value,
  disabled,
  submitLabel,
  placeholder,
  secondaryAction,
  onChange,
  onSubmit,
  onCancel,
}: MarkdownCommentEditorProps): React.ReactElement {
  const inputRef = React.useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  // Bumped when the toolbar inserts an "@": the caret is only moved on the next
  // frame, so the typeahead needs telling to look again once it has landed.
  const [caretRevision, setCaretRevision] = React.useState(0);
  const resolveMention = React.useContext(MentionContext);
  // Names chosen from the typeahead. A ref, because the mapping has to be in
  // place by the time the very next change is converted back.
  const insertedNamesRef = React.useRef(new Map<string, string>());

  // The comment is stored as `@<GUID>` but written as `@Display Name`: the
  // editor is the only place that knows both forms.
  const display = React.useMemo(
    () => toDisplayText(value, (id) => resolveMention?.(id)),
    [resolveMention, value],
  );

  const toStored = (next: string): string =>
    toStoredText(next, mergeMentionDirectory(display.names, insertedNamesRef.current));

  const rememberMention = (identity: DirectoryIdentity): void => {
    insertedNamesRef.current.set(identity.displayName.toLowerCase(), identity.id);
  };

  const applyMarkdown = (action: MarkdownAction): void => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    const source = display.text;
    const start = input.selectionStart ?? source.length;
    const end = input.selectionEnd ?? start;
    const selected =
      action.placeholder === undefined ? "" : source.slice(start, end) || action.placeholder;
    const replacement = `${action.prefix}${selected}${action.suffix ?? ""}`;
    onChange(toStored(`${source.slice(0, start)}${replacement}${source.slice(end)}`));

    window.requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(
        start + action.prefix.length,
        start + action.prefix.length + selected.length,
      );
      setCaretRevision((revision) => revision + 1);
    });
  };

  return (
    <div className="markdown-editor">
      <div className="markdown-toolbar" role="toolbar" aria-label="Comment formatting">
        {actions.map((action) => (
          <Button
            key={action.id}
            subtle
            iconProps={{ iconName: action.iconName }}
            ariaLabel={action.label}
            disabled={disabled}
            tooltipProps={{ text: action.label }}
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
        value={display.text}
        disabled={disabled}
        onChange={(_event, nextValue) => onChange(toStored(nextValue))}
      />
      <MentionTypeahead
        inputRef={inputRef}
        value={display.text}
        caretRevision={caretRevision}
        disabled={disabled}
        onChange={(nextValue) => onChange(toStored(nextValue))}
        onMentionInserted={rememberMention}
      />
      {value.trim() && (
        <section className="markdown-preview" aria-label="Comment preview">
          <p className="markdown-preview-label">Preview</p>
          <Markdown content={value} />
        </section>
      )}
      <div className="markdown-actions">
        <Button text={submitLabel} primary disabled={disabled || !value.trim()} onClick={onSubmit} />
        {secondaryAction && (
          <Button
            text={secondaryAction.label}
            disabled={disabled || !value.trim()}
            onClick={secondaryAction.onClick}
          />
        )}
        {onCancel && <Button text="Cancel" disabled={disabled} onClick={onCancel} />}
      </div>
    </div>
  );
}