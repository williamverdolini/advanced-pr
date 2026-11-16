/**
 * Where a new thread will be anchored. The same shape as the diff's selection,
 * restated here because `core/` cannot import from `components/`.
 */
export interface CommentDraftAnchor {
  readonly side: "left" | "right";
  readonly startLine: number;
  readonly startOffset: number;
  readonly endLine: number;
  readonly endOffset: number;
}

/**
 * Text typed into a comment editor and not yet posted. A new thread's draft also
 * carries its anchor, because the composer is reopened at that line when the
 * reader comes back to the file.
 */
export interface CommentDraft {
  readonly text: string;
  readonly anchor?: CommentDraftAnchor;
}

/** Every unposted comment of one pull request, by the editor it was typed in. */
export type CommentDrafts = Readonly<Record<string, CommentDraft>>;

// One new thread per file: the diff has a single composer, and moving it to
// another line carries what was typed with it.
export function newThreadDraftKey(filePath: string): string {
  return `new:${filePath}`;
}

export function replyDraftKey(threadId: number): string {
  return `reply:${threadId}`;
}

export function editDraftKey(threadId: number, commentId: number): string {
  return `edit:${threadId}:${commentId}`;
}

/**
 * The drafts with one entry replaced, or removed when `draft` is undefined. The
 * same object comes back when nothing changed, so a keystroke that does not
 * alter the text does not re-render every editor.
 */
export function withCommentDraft(
  drafts: CommentDrafts,
  key: string,
  draft: CommentDraft | undefined,
): CommentDrafts {
  const current = drafts[key];
  if (!draft) {
    if (!current) {
      return drafts;
    }
    return Object.fromEntries(Object.entries(drafts).filter(([each]) => each !== key));
  }

  if (current && current.text === draft.text && sameAnchor(current.anchor, draft.anchor)) {
    return drafts;
  }

  return { ...drafts, [key]: draft };
}

/**
 * Drafts read back from storage, under the ones typed since: the read is
 * asynchronous, and a reader quick enough to start writing before it finishes
 * must not have that text replaced by an older copy.
 */
export function mergeCommentDrafts(stored: CommentDrafts, current: CommentDrafts): CommentDrafts {
  return Object.keys(stored).length === 0 ? current : { ...stored, ...current };
}

/**
 * Only drafts with something typed in them are worth keeping beyond this page:
 * an empty composer reopened after a reload is noise, not a recovered comment.
 */
export function writeCommentDrafts(drafts: CommentDrafts): string {
  const kept = Object.fromEntries(
    Object.entries(drafts).filter(([, draft]) => draft.text.trim() !== ""),
  );
  return JSON.stringify(kept);
}

/**
 * Anything on the extension's storage could have written the value, and an
 * older build may have written another shape, so each entry is checked on its
 * own and a bad one is dropped rather than discarding the rest.
 */
export function readCommentDrafts(stored: string | null | undefined): CommentDrafts {
  if (!stored) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return {};
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return {};
  }

  const drafts: Record<string, CommentDraft> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const draft = readDraft(value);
    if (draft) {
      drafts[key] = draft;
    }
  }

  return drafts;
}

function readDraft(value: unknown): CommentDraft | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string" || record.text.trim() === "") {
    return undefined;
  }
  if (record.anchor === undefined) {
    return { text: record.text };
  }

  const anchor = readAnchor(record.anchor);
  return anchor ? { text: record.text, anchor } : undefined;
}

function readAnchor(value: unknown): CommentDraftAnchor | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const lines = [record.startLine, record.startOffset, record.endLine, record.endOffset];
  if (
    (record.side !== "left" && record.side !== "right") ||
    !lines.every((line) => typeof line === "number" && Number.isInteger(line) && line >= 0)
  ) {
    return undefined;
  }

  return {
    side: record.side,
    startLine: record.startLine as number,
    startOffset: record.startOffset as number,
    endLine: record.endLine as number,
    endOffset: record.endOffset as number,
  };
}

function sameAnchor(
  left: CommentDraftAnchor | undefined,
  right: CommentDraftAnchor | undefined,
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }

  return (
    left.side === right.side &&
    left.startLine === right.startLine &&
    left.startOffset === right.startOffset &&
    left.endLine === right.endLine &&
    left.endOffset === right.endOffset
  );
}
