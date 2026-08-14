import * as React from "react";
import type { MentionIdentity, MentionResolver } from "../components/mentionContext";
import { findMentionIds } from "../core/markdown";
import type { PullRequestWorkspace } from "../platform/azureDevOpsClient";
import { getKnownIdentity, resolveIdentities } from "../platform/identityService";

/**
 * Resolves the identity id a mention token carries to a name. People already on
 * the pull request resolve for free; anyone else has to be looked up, because a
 * thread comes back with `identities: null` even when it carries a mention.
 */
export function useMentionDirectory(workspace: PullRequestWorkspace): MentionResolver {
  const { authorId, authorName, reviewers, threads } = workspace;
  const [directoryExtras, setDirectoryExtras] = React.useState<
    ReadonlyMap<string, MentionIdentity>
  >(new Map());

  const knownIdentities = React.useMemo(() => {
    const directory = new Map<string, MentionIdentity>();
    directory.set(authorId.toLowerCase(), { displayName: authorName });
    for (const reviewer of reviewers) {
      directory.set(reviewer.id.toLowerCase(), { displayName: reviewer.displayName });
    }
    for (const thread of threads) {
      for (const comment of thread.comments) {
        directory.set(comment.authorId.toLowerCase(), { displayName: comment.authorName });
      }
    }
    return directory;
  }, [authorId, authorName, reviewers, threads]);

  React.useEffect(() => {
    const mentioned = new Set(
      threads.flatMap((thread) =>
        thread.comments.flatMap((comment) => findMentionIds(comment.content)),
      ),
    );
    const missing = [...mentioned].filter(
      (id) => !knownIdentities.has(id) && !directoryExtras.has(id),
    );
    if (missing.length === 0) {
      return;
    }

    let active = true;
    void resolveIdentities(missing).then((found) => {
      if (!active || found.size === 0) {
        return;
      }
      setDirectoryExtras((current) => new Map([...current, ...found]));
    });

    return () => {
      active = false;
    };
  }, [directoryExtras, knownIdentities, threads]);

  return React.useCallback(
    (id: string): MentionIdentity | undefined =>
      knownIdentities.get(id.toLowerCase()) ??
      directoryExtras.get(id.toLowerCase()) ??
      // Anyone the picker has already returned, which covers the mention being
      // typed right now: it belongs to no saved comment yet, so the lookup
      // effect above would never see it.
      getKnownIdentity(id),
    [directoryExtras, knownIdentities],
  );
}
