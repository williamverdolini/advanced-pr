import { stableHash } from "../core/hash";
import { readCommentDrafts, type CommentDrafts } from "../core/commentDrafts";
import type { PullRequestWorkspace } from "./azureDevOpsClient";
import { getExtensionDataManager, userScope } from "./extensionDataManager";

export type CommentDraftScope = Pick<PullRequestWorkspace, "id" | "repositoryId" | "projectId">;

/**
 * Unposted comments live in the extension data service, scoped to the reader,
 * and deliberately never in `localStorage`: the extension's origin is the
 * Marketplace CDN, shared with every other extension published from it, and a
 * draft is text its author has not chosen to show anyone yet. If the service
 * cannot be reached the drafts still survive moving between files, in memory;
 * they are lost only on a reload.
 */
export async function loadCommentDrafts(scope: CommentDraftScope): Promise<CommentDrafts> {
  const manager = await getExtensionDataManager();
  const stored = await manager.getValue<string>(storageKey(scope), {
    ...userScope,
    defaultValue: "",
  });

  return readCommentDrafts(stored);
}

/** Takes the value already serialized, so the caller can skip a write that changes nothing. */
export async function saveCommentDrafts(
  scope: CommentDraftScope,
  serialized: string,
): Promise<void> {
  const manager = await getExtensionDataManager();
  await manager.setValue(storageKey(scope), serialized, userScope);
}

function storageKey(scope: CommentDraftScope): string {
  const identity = [scope.projectId ?? "project", scope.repositoryId, scope.id].join(":");
  return `comment-drafts-${stableHash(identity)}`;
}
