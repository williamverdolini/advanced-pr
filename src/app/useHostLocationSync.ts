import * as React from "react";
import {
  findStepForFile,
  normalizeRepositoryPath,
  type ReviewStep,
} from "../core/reviewPlan";
import { parseSharedId } from "../core/shareLink";
import type { ChangedFile } from "../platform/azureDevOpsClient";
import { getHostQueryParams, setHostQueryParams } from "../platform/hostNavigation";

export interface HostLocationTarget {
  file: ChangedFile;
  /**
   * The step the file belongs to. It comes with the file: landing on a file
   * outside the current step would show it against a file list it does not
   * belong to.
   */
  step?: ReviewStep;
  /** The thread a share link named, when it is one of the threads on that file. */
  threadId?: number;
  /** The comment inside it the link was copied from, when the link carried one. */
  commentId?: number;
}

export interface HostLocationSyncInput {
  files: readonly ChangedFile[];
  steps: readonly ReviewStep[];
  selectedFile?: ChangedFile;
  /**
   * Called at most once, and only if the host arrived carrying a path that names
   * a file in this review.
   */
  onRestore: (target: HostLocationTarget) => void;
}

/**
 * Keeps the open file in the host's `path` query parameter, the one the native
 * Files tab already uses. Reusing it means a refresh comes back to the same
 * file, and switching between that tab and this one keeps the place.
 *
 * `threadId` and `commentId` ride along on arrival only: they are what a shared
 * link adds, and they are dropped once honoured so that opening another file
 * cannot leave the URL pointing at a comment that is no longer on screen.
 */
export function useHostLocationSync({
  files,
  steps,
  selectedFile,
  onRestore,
}: HostLocationSyncInput): void {
  // The caller passes a fresh closure on every render; it travels through a ref
  // so it cannot retrigger the restore, which must happen once.
  const restore = React.useRef(onRestore);
  React.useEffect(() => {
    restore.current = onRestore;
  });

  const restored = React.useRef(false);
  React.useEffect(() => {
    if (restored.current || files.length === 0) {
      return;
    }

    restored.current = true;
    let active = true;
    void getHostQueryParams().then((params) => {
      const wanted = normalizeRepositoryPath(params.path ?? "").toLocaleLowerCase();
      if (!active || !wanted) {
        return;
      }

      const file = files.find((candidate) => candidate.path.toLocaleLowerCase() === wanted);
      if (!file) {
        return;
      }

      const threadId = parseSharedId(params.threadId);
      const commentId = parseSharedId(params.commentId);
      if (threadId !== undefined) {
        void setHostQueryParams({ threadId: "", commentId: "" });
      }

      restore.current({
        file,
        step: findStepForFile(steps, file.path),
        threadId,
        commentId,
      });
    });

    return () => {
      active = false;
    };
  }, [files, steps]);

  React.useEffect(() => {
    if (selectedFile) {
      void setHostQueryParams({ path: `/${selectedFile.path}` });
    }
  }, [selectedFile]);
}
