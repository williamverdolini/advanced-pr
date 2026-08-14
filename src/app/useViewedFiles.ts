import * as React from "react";
import { withMembers } from "../core/toggleSet";
import {
  loadViewedFiles,
  saveViewedFiles,
  type ViewedFilesScope,
} from "../platform/viewedFilesStore";

const noPaths: ReadonlySet<string> = new Set();

export interface ViewedFiles {
  viewedFiles: ReadonlySet<string>;
  setFilesViewed: (paths: readonly string[], viewed: boolean) => void;
}

/**
 * Which files the reviewer has marked as viewed. Read once per pull request and
 * written back on every change, per user, by the extension data service.
 */
export function useViewedFiles(scope: ViewedFilesScope): ViewedFiles {
  const [viewedFiles, setViewedFiles] = React.useState(noPaths);
  // The set is mirrored in a ref so a change can be computed and saved outside
  // the state updater: React is free to call an updater more than once, and the
  // save must happen exactly as often as the reviewer asks for it.
  const latest = React.useRef(viewedFiles);

  React.useEffect(() => {
    let active = true;
    void loadViewedFiles(scope).then((paths) => {
      if (active) {
        latest.current = paths;
        setViewedFiles(paths);
      }
    });

    return () => {
      active = false;
    };
  }, [scope]);

  const setFilesViewed = React.useCallback(
    (paths: readonly string[], viewed: boolean): void => {
      const next = withMembers(latest.current, paths, viewed);
      if (next === latest.current) {
        return;
      }

      latest.current = next;
      setViewedFiles(next);
      void saveViewedFiles(scope, next);
    },
    [scope],
  );

  return { viewedFiles, setFilesViewed };
}
