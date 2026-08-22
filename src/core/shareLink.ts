import { normalizeRepositoryPath } from "./reviewPlan";

export interface ThreadShareTarget {
  /** The pull request page, as Azure DevOps itself links to it. */
  pullRequestUrl: string;
  /**
   * Contribution id of the Guided Review tab, which is what the host reads from
   * `_a` to decide which tab opens. Without it the link lands on the default
   * Overview tab, so a share is only offered when it is known.
   */
  tabId: string;
  /** Repository path of the file the thread is anchored to. */
  filePath: string;
  threadId: number;
  /**
   * The comment the link was copied from. The thread is what the review shows
   * and scrolls to; this only says which of its comments to point at once it is
   * on screen, so a link without it still works.
   */
  commentId: number;
}

/**
 * A link back to one comment: the pull request, the Guided Review tab, the file
 * the thread hangs off, and the thread itself. The parameters are the ones the
 * tab reads on load, so following the link reproduces the step, the file and the
 * selected thread.
 */
export function buildThreadShareLink({
  pullRequestUrl,
  tabId,
  filePath,
  threadId,
  commentId,
}: ThreadShareTarget): string {
  // Whatever query or fragment the base carried is dropped: it is the pull
  // request's own tab and file state, and keeping it would fight the parameters
  // written here.
  const base = pullRequestUrl.split(/[?#]/)[0];
  const query = [
    `_a=${encodeURIComponent(tabId)}`,
    `path=${encodePath(normalizeRepositoryPath(filePath))}`,
    `threadId=${threadId}`,
    `commentId=${commentId}`,
  ].join("&");
  return `${base}?${query}`;
}

/**
 * Rooted, and with its separators left alone: this is the same `path` parameter
 * the native Files tab writes, and escaping the slashes would still round-trip
 * but produce a link nobody can read.
 */
function encodePath(path: string): string {
  return `/${encodeURIComponent(path).replace(/%2F/g, "/")}`;
}

/** One id of a share link, when the host arrived carrying a usable one. */
export function parseSharedId(value: string | undefined): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}
