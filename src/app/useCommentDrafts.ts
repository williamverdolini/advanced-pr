import * as React from "react";
import {
  mergeCommentDrafts,
  withCommentDraft,
  writeCommentDrafts,
  type CommentDraft,
  type CommentDrafts,
} from "../core/commentDrafts";
import {
  loadCommentDrafts,
  saveCommentDrafts,
  type CommentDraftScope,
} from "../platform/commentDraftStore";

/** Undefined removes the draft: it was posted, or the editor was cancelled. */
export type CommentDraftUpdate =
  | CommentDraft
  | undefined
  | ((current: CommentDraft | undefined) => CommentDraft | undefined);

export interface CommentDraftsApi {
  readonly drafts: CommentDrafts;
  readonly setDraft: (key: string, update: CommentDraftUpdate) => void;
}

// Long enough that typing is one write per pause rather than one per key, short
// enough that a reader who closes the tab right after typing loses little.
const saveDelay = 1000;

/**
 * The comments being written on this pull request, held above every editor so
 * that leaving a file, a step or a thread does not throw away what was typed.
 * They are also stored for the reader, so a reload brings them back.
 */
export function useCommentDrafts(scope: CommentDraftScope): CommentDraftsApi {
  const [drafts, setDrafts] = React.useState<CommentDrafts>({});
  // Nothing is written until the stored drafts have been read: an early write
  // would replace them with whatever was typed in the meantime.
  const [loaded, setLoaded] = React.useState(false);
  const lastSaved = React.useRef<string | undefined>(undefined);
  const pendingSave = React.useRef<(() => void) | undefined>(undefined);

  React.useEffect(() => {
    let active = true;
    loadCommentDrafts(scope).then(
      (stored) => {
        if (!active) {
          return;
        }
        lastSaved.current = writeCommentDrafts(stored);
        setDrafts((current) => mergeCommentDrafts(stored, current));
        setLoaded(true);
      },
      () => {
        // Unreachable storage leaves the drafts in memory, which still covers
        // moving between files; only a reload loses them.
      },
    );

    return () => {
      active = false;
    };
  }, [scope]);

  React.useEffect(() => {
    pendingSave.current = undefined;
    if (!loaded) {
      return;
    }

    const serialized = writeCommentDrafts(drafts);
    if (serialized === lastSaved.current) {
      return;
    }

    const save = (): void => {
      pendingSave.current = undefined;
      lastSaved.current = serialized;
      saveCommentDrafts(scope, serialized).catch(() => {
        // Forgotten so the next change retries rather than being skipped as
        // already saved.
        lastSaved.current = undefined;
      });
    };
    pendingSave.current = save;
    const timer = window.setTimeout(save, saveDelay);

    return () => window.clearTimeout(timer);
  }, [drafts, loaded, scope]);

  // A save still waiting for its delay goes out when the review closes, rather
  // than being dropped with the timer.
  React.useEffect(
    () => () => {
      pendingSave.current?.();
    },
    [],
  );

  const setDraft = React.useCallback(
    (key: string, update: CommentDraftUpdate): void =>
      setDrafts((current) =>
        withCommentDraft(
          current,
          key,
          typeof update === "function" ? update(current[key]) : update,
        ),
      ),
    [],
  );

  return { drafts, setDraft };
}
