import * as React from "react";
import { toggleMember, withMember } from "../core/toggleSet";

const noThreads: ReadonlySet<number> = new Set();

export interface CollapsedThreads {
  collapsedThreadIds: ReadonlySet<number>;
  setCollapsed: (threadId: number, collapsed: boolean) => void;
  /** The glyph in the margin is the only way back for a collapsed thread. */
  toggle: (threadId: number) => void;
}

/** Which inline threads the reviewer has folded away. */
export function useCollapsedThreads(): CollapsedThreads {
  const [collapsedThreadIds, setCollapsedThreadIds] = React.useState(noThreads);

  const setCollapsed = React.useCallback((threadId: number, collapsed: boolean): void => {
    setCollapsedThreadIds((current) => withMember(current, threadId, collapsed));
  }, []);

  const toggle = React.useCallback((threadId: number): void => {
    setCollapsedThreadIds((current) => toggleMember(current, threadId));
  }, []);

  return { collapsedThreadIds, setCollapsed, toggle };
}
