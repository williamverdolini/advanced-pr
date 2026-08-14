import * as React from "react";

export interface MentionIdentity {
  displayName: string;
  uniqueName?: string;
}

/**
 * Resolves a mentioned identity id to a name. Comment threads come back with
 * `identities: null` even when they carry a mention, so the directory has to be
 * assembled by the caller rather than read off the thread.
 */
export type MentionResolver = (id: string) => MentionIdentity | undefined;

export const MentionContext = React.createContext<MentionResolver | undefined>(undefined);
