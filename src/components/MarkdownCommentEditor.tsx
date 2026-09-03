import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { TextField } from "azure-devops-ui/TextField";
import { attachmentImageMarkdown, extensionForMediaType } from "../core/attachments";
import {
  mergeMentionDirectory,
  toDisplayText,
  toStoredText,
} from "../core/mentionText";
import type { DirectoryIdentity } from "../platform/identityService";
import { AttachmentContext } from "./attachmentContext";
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
  /**
   * Puts the caret in the box as soon as it appears, for an editor that opened
   * because somebody asked for it: clicking the margin to write a comment and
   * then having to click the box as well is one click too many.
   */
  autoFocus?: boolean;
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
  autoFocus = false,
  onChange,
  onSubmit,
  onCancel,
}: MarkdownCommentEditorProps): React.ReactElement {
  const inputRef = React.useRef<HTMLTextAreaElement & HTMLInputElement>(null);
  // Focused on the next frame rather than on mount, and not through the input's
  // own `autoFocus`: this editor is mounted inside a Monaco view zone by a
  // portal, in the same gesture that Monaco is handling as a click on itself.
  // Monaco puts the focus back on the code when it finishes with that click, so
  // asking for it any earlier loses it again.
  React.useEffect(() => {
    if (!autoFocus) {
      return;
    }

    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [autoFocus]);

  // Bumped when the toolbar inserts an "@": the caret is only moved on the next
  // frame, so the typeahead needs telling to look again once it has landed.
  const [caretRevision, setCaretRevision] = React.useState(0);
  const resolveMention = React.useContext(MentionContext);
  const attachments = React.useContext(AttachmentContext);
  const [uploadError, setUploadError] = React.useState<string>();
  const uploadCountRef = React.useRef(0);
  // The text as last rendered, which is not the text the paste started from:
  // typing carries on while the image is on its way, so the placeholder is
  // replaced in whatever has been written by the time the upload answers.
  const latestValueRef = React.useRef(value);
  // Names chosen from the typeahead. A ref, because the mapping has to be in
  // place by the time the very next change is converted back.
  const insertedNamesRef = React.useRef(new Map<string, string>());

  // Cancelling or posting the comment unmounts the editor, which an upload
  // still in flight has to notice before it writes into it.
  const mountedRef = React.useRef(true);

  React.useEffect(() => {
    latestValueRef.current = value;
  }, [value]);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
    },
    [],
  );

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

  const insertAtCaret = (insertion: string): void => {
    const input = inputRef.current;
    const source = display.text;
    const start = input?.selectionStart ?? source.length;
    const end = input?.selectionEnd ?? start;
    onChange(toStored(`${source.slice(0, start)}${insertion}${source.slice(end)}`));

    window.requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + insertion.length, start + insertion.length);
    });
  };

  const uploadImage = async (file: File, name: string, placeholder: string): Promise<void> => {
    if (!attachments) {
      return;
    }

    let markdown = "";
    let failure: string | undefined;
    try {
      const attachment = await attachments.upload(file);
      markdown = attachmentImageMarkdown(attachment.name, attachment.url);
    } catch {
      failure = `Unable to attach ${name}.`;
    }

    // The editor is gone: the comment was cancelled or posted while the image
    // was on its way, and the attachment stays on the pull request unused.
    if (!mountedRef.current) {
      return;
    }

    // A function replacement, so a `$` in the URL is not read as a group
    // reference.
    onChange(latestValueRef.current.replace(placeholder, () => markdown));
    if (failure) {
      setUploadError(failure);
    }
  };

  /**
   * A screenshot pasted into the comment. Azure DevOps stores it as an
   * attachment of the pull request and the comment links to it, which is what
   * the Files tab does with the same paste.
   */
  const pasteImages = (event: React.ClipboardEvent): void => {
    if (!attachments || disabled) {
      return;
    }

    // Text wins when the clipboard carries both, which is what copying a range
    // out of Excel or a table out of Word produces: uploading the picture of it
    // would throw away the content that can actually be read and searched.
    if (event.clipboardData.getData("text/plain").trim()) {
      return;
    }

    const images = [...event.clipboardData.files].filter((file) =>
      file.type.startsWith("image/"),
    );
    if (images.length === 0) {
      return;
    }

    // Letting the default run as well would paste the file name as text beside
    // the image.
    event.preventDefault();
    setUploadError(undefined);

    // Every placeholder is inserted in one go: the caret position is read off
    // the field, and the second insertion would read it before React has
    // applied the first.
    const uploads = images.map((file) => {
      uploadCountRef.current += 1;
      const name = file.name || `image${extensionForMediaType(file.type)}`;

      // An image node the renderer cannot load, so the preview shows this text
      // instead: `upload:` is not a scheme `safeImageHref` accepts. The counter
      // keeps it unique, because the replacement is by text.
      return {
        file,
        name,
        placeholder: `![Uploading ${name}…](upload:${uploadCountRef.current})`,
      };
    });
    insertAtCaret(uploads.map((upload) => upload.placeholder).join("\n"));
    for (const upload of uploads) {
      void uploadImage(upload.file, upload.name, upload.placeholder);
    }
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
        onPaste={pasteImages}
      />
      {uploadError && <p className="markdown-upload-error">{uploadError}</p>}
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