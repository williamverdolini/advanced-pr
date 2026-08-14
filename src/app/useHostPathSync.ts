import * as React from "react";
import {
  findStepForFile,
  normalizeRepositoryPath,
  type ReviewStep,
} from "../core/reviewPlan";
import type { ChangedFile } from "../platform/azureDevOpsClient";
import { getHostQueryParams, setHostQueryParams } from "../platform/hostNavigation";

export interface HostPathSyncInput {
  files: readonly ChangedFile[];
  steps: readonly ReviewStep[];
  selectedFile?: ChangedFile;
  /**
   * Called at most once, and only if the host arrived carrying a path that names
   * a file in this review. The step comes with the file: landing on a file
   * outside the current step would show it against a file list it does not
   * belong to.
   */
  onRestore: (file: ChangedFile, step: ReviewStep | undefined) => void;
}

/**
 * Keeps the open file in the host's `path` query parameter, the one the native
 * Files tab already uses. Reusing it means a refresh comes back to the same
 * file, and switching between that tab and this one keeps the place.
 */
export function useHostPathSync({
  files,
  steps,
  selectedFile,
  onRestore,
}: HostPathSyncInput): void {
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
      if (file) {
        restore.current(file, findStepForFile(steps, file.path));
      }
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
