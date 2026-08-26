import { getClient } from "azure-devops-extension-api/Common";
import {
  CommentThreadStatus,
  CommentType,
  GitRestClient,
  PullRequestStatus,
  type Comment,
  type GitPullRequestChange,
  type GitPullRequestCommentThread,
  type IdentityRefWithVote,
} from "azure-devops-extension-api/Git";
import type { IdentityRef } from "azure-devops-extension-api/WebApi";
import { imageMediaType, uniqueAttachmentName } from "../core/attachments";
import { classifyFileChange, type FileChangeKind } from "../core/changeType";
import { formatMarker } from "../core/marker";
import { languageForPath } from "../core/language";
import {
  formatLedgerEvent,
  parseLedgerEvent,
  type LedgerEventPayload,
  type ReviewEvent,
} from "../core/ledger";
import {
  buildStepPlan,
  normalizeRepositoryPath,
  parsePlanMarker,
  type StepPlan,
} from "../core/reviewPlan";
import type { PullRequestContext } from "./extensionContext";

/**
 * One client for the whole session: `getClient` constructs a new instance on
 * every call, and every function here wants the same one, the way
 * `identityService` holds on to the host service it resolves.
 */
let cachedClient: GitRestClient | undefined;

function gitClient(): GitRestClient {
  cachedClient ??= getClient(GitRestClient);
  return cachedClient;
}

export interface PullRequestReviewer {
  id: string;
  displayName: string;
  vote: number;
  isRequired: boolean;
}

export interface ChangedFile {
  path: string;
  originalPath?: string;
  objectId?: string;
  originalObjectId?: string;
  changeTrackingId: number;
  changeKind: FileChangeKind;
}

export type PullRequestState = "active" | "completed" | "abandoned" | "unknown";

export interface PullRequestWorkspace {
  id: number;
  state: PullRequestState;
  title: string;
  description: string;
  sourceBranch: string;
  targetBranch: string;
  repositoryId: string;
  repositoryName: string;
  projectId?: string;
  /** Only for building links people read: every call goes by id. */
  projectName?: string;
  authorId: string;
  authorName: string;
  webUrl?: string;
  iterationId: number;
  reviewers: PullRequestReviewer[];
  files: ChangedFile[];
  threadCount: number;
  openThreadCount: number;
  plan: StepPlan;
  /**
   * Thread the review events are appended to. It is the plan thread when a plan
   * exists, otherwise the general thread that already holds events. A pull
   * request without a plan still has one reviewable step, so it still needs a
   * ledger. Undefined until the first event creates one.
   */
  ledgerThreadId?: number;
  ledgerEvents: ReviewEvent[];
  threads: ReviewThread[];
}

export interface ReviewThreadPosition {
  side: "left" | "right";
  startLine: number;
  startOffset: number;
  endLine: number;
  endOffset: number;
}

export interface ReviewComment {
  id: number;
  authorId: string;
  authorName: string;
  /** The author's picture, when the identity carries one. */
  authorImageUrl?: string;
  content: string;
  publishedDate: string;
  likeCount: number;
  likedBy: string[];
}

export interface ReviewThread {
  id: number;
  filePath?: string;
  status: CommentThreadStatus;
  isOpen: boolean;
  position?: ReviewThreadPosition;
  comments: ReviewComment[];
}

export interface FileDiffContent {
  original: string;
  modified: string;
  language: string;
}

/**
 * Everything needed to fetch blobs, without pinning the whole workspace: the
 * diff effect must not re-run when only threads change.
 */
export type BlobSource = Pick<PullRequestWorkspace, "repositoryId" | "projectId">;

/**
 * Everything needed to read and write attachments. Narrow for the same reason
 * as `BlobSource`: the images cached against it must survive a refresh of the
 * threads.
 */
export type AttachmentSource = Pick<PullRequestWorkspace, "id" | "repositoryId" | "projectId">;

type ThreadProjection = Pick<
  PullRequestWorkspace,
  | "plan"
  | "ledgerThreadId"
  | "ledgerEvents"
  | "threads"
  | "threadCount"
  | "openThreadCount"
>;

export async function loadPullRequestWorkspace(
  context: PullRequestContext,
): Promise<PullRequestWorkspace> {
  if (!context.pullRequestId) {
    throw new Error("Azure DevOps did not provide a pull request ID.");
  }

  const client = gitClient();
  const pullRequest = context.repositoryId
    ? await client.getPullRequest(
        context.repositoryId,
        context.pullRequestId,
        context.projectId,
      )
    : await client.getPullRequestById(context.pullRequestId, context.projectId);
  const repositoryId = pullRequest.repository.id;
  const projectId = context.projectId ?? pullRequest.repository.project?.id;
  const [iterations, threads] = await Promise.all([
    client.getPullRequestIterations(repositoryId, pullRequest.pullRequestId, projectId),
    client.getThreads(repositoryId, pullRequest.pullRequestId, projectId),
  ]);
  const currentIteration = [...iterations].sort((left, right) => right.id - left.id)[0];
  if (!currentIteration) {
    throw new Error("The pull request does not contain an iteration.");
  }

  const changes = await getAllChanges(
    client,
    repositoryId,
    pullRequest.pullRequestId,
    currentIteration.id,
    projectId,
  );
  const files = changes
    .filter((change) => !change.item?.isFolder && Boolean(changePath(change)))
    .map(mapChangedFile);
  return {
    id: pullRequest.pullRequestId,
    state: mapPullRequestState(pullRequest.status),
    title: pullRequest.title,
    description: pullRequest.description,
    sourceBranch: shortBranchName(pullRequest.sourceRefName),
    targetBranch: shortBranchName(pullRequest.targetRefName),
    repositoryId,
    repositoryName: pullRequest.repository.name,
    projectId,
    projectName: pullRequest.repository.project?.name,
    authorId: pullRequest.createdBy.id,
    authorName: pullRequest.createdBy.displayName,
    webUrl: pullRequest._links?.web?.href as string | undefined,
    iterationId: currentIteration.id,
    reviewers: pullRequest.reviewers.map((reviewer) => ({
      id: reviewer.id,
      displayName: reviewer.displayName,
      vote: reviewer.vote,
      isRequired: reviewer.isRequired,
    })),
    files,
    ...projectThreads(
      threads,
      pullRequest.createdBy.id,
      pullRequest.pullRequestId,
      files.map((file) => file.path),
    ),
  };
}

/**
 * Re-reads only the comment threads and re-derives everything that depends on
 * them. The returned workspace keeps `files` and the rest of the pull request
 * metadata by reference, so the diff viewer is not torn down after every
 * inline reply, like or resolve.
 */
export async function refreshThreads(
  workspace: PullRequestWorkspace,
): Promise<PullRequestWorkspace> {
  const { repositoryId, id: pullRequestId, projectId } = workspace;
  const threads = await gitClient().getThreads(repositoryId, pullRequestId, projectId);

  return {
    ...workspace,
    ...projectThreads(
      threads,
      workspace.authorId,
      pullRequestId,
      workspace.files.map((file) => file.path),
    ),
  };
}

function projectThreads(
  threads: readonly GitPullRequestCommentThread[],
  authorId: string,
  pullRequestId: number,
  filePaths: readonly string[],
): ThreadProjection {
  const planThread = selectAuthorizedPlan(threads, authorId);
  const marker = planThread?.comments[0]
    ? parsePlanMarker(planThread.comments[0].content)
    : undefined;
  const plan = buildStepPlan(
    planThread?.comments[0]?.content ?? "",
    filePaths,
    marker ?? { planId: `fallback-pr-${pullRequestId}`, version: 1 },
    planThread?.id,
  );
  const visibleThreads = threads.filter((thread) => !thread.isDeleted);
  // Events are read from every general thread, not only the plan's. Their
  // authority never came from where they sit: the reviewer is the Azure DevOps
  // comment author, and the reducer only accepts events matching the current
  // plan identity and hash. Reading wider is what lets a pull request without a
  // plan keep a ledger of its own.
  const ledgerThreads = visibleThreads
    .filter((thread) => !thread.threadContext?.filePath)
    .map((thread) => ({
      thread,
      events: thread.comments
        .map((comment) =>
          parseLedgerEvent(
            comment.content,
            comment.author.id,
            comment.publishedDate.toISOString(),
            comment.id,
          ),
        )
        .filter((event): event is ReviewEvent => Boolean(event)),
    }));

  return {
    plan,
    ledgerThreadId:
      planThread?.id ??
      ledgerThreads.find((candidate) => candidate.events.length > 0)?.thread.id,
    ledgerEvents: ledgerThreads.flatMap((candidate) => candidate.events),
    threads: visibleThreads.map(mapReviewThread),
    threadCount: visibleThreads.length,
    openThreadCount: visibleThreads.filter(
      (thread) =>
        thread.status === CommentThreadStatus.Active ||
        thread.status === CommentThreadStatus.Pending,
    ).length,
  };
}

export async function loadChangedFileDiff(
  source: BlobSource,
  file: ChangedFile,
): Promise<FileDiffContent> {
  const client = gitClient();
  const [original, modified] = await Promise.all([
    getTextBlob(client, source.repositoryId, file.originalObjectId, source.projectId),
    getTextBlob(client, source.repositoryId, file.objectId, source.projectId),
  ]);

  return {
    original,
    modified,
    language: languageForPath(file.path),
  };
}

export async function appendLedgerEvent(
  workspace: PullRequestWorkspace,
  label: string,
  event: LedgerEventPayload,
): Promise<void> {
  const client = gitClient();
  const { repositoryId, id: pullRequestId, projectId } = workspace;
  const content = formatLedgerEvent(label, event);
  const comment = {
    content,
    commentType: CommentType.Text,
    parentCommentId: 0,
  } as Comment;

  try {
    if (workspace.ledgerThreadId) {
      await client.createComment(
        comment,
        repositoryId,
        pullRequestId,
        workspace.ledgerThreadId,
        projectId,
      );
    } else {
      // First event on a pull request with no plan: the ledger thread is opened
      // by whoever records it, and every later event joins it.
      await client.createThread(
        {
          status: CommentThreadStatus.Active,
          comments: [comment],
        } as GitPullRequestCommentThread,
        repositoryId,
        pullRequestId,
        projectId,
      );
    }
  } catch (error) {
    const threads = await client.getThreads(repositoryId, pullRequestId, projectId);
    const eventWasWritten = threads
      .flatMap((thread) => thread.comments)
      .some((existingComment) => existingComment.content.includes(event.eventId));
    if (!eventWasWritten) {
      throw error;
    }
  }
}

export async function setReviewerVote(
  workspace: PullRequestWorkspace,
  reviewerId: string,
  vote: -10 | -5 | 0 | 5 | 10,
): Promise<void> {
  await gitClient().createPullRequestReviewer(
    { id: reviewerId, vote } as IdentityRefWithVote,
    workspace.repositoryId,
    workspace.id,
    reviewerId,
    workspace.projectId,
  );
}

export async function createAnchoredThread(
  workspace: PullRequestWorkspace,
  file: ChangedFile,
  position: ReviewThreadPosition,
  content: string,
): Promise<void> {
  const start = { line: position.startLine, offset: position.startOffset };
  const end = { line: position.endLine, offset: position.endOffset };
  const threadContext = {
    filePath: file.path,
    leftFileStart: position.side === "left" ? start : undefined,
    leftFileEnd: position.side === "left" ? end : undefined,
    rightFileStart: position.side === "right" ? start : undefined,
    rightFileEnd: position.side === "right" ? end : undefined,
  };
  // The comparison this anchor was taken from, and it has to be the one actually
  // on screen: `getAllChanges` asks for the iteration against the base
  // (`compareTo: 0`), which Azure DevOps expresses as the same iteration at both
  // ends. Naming iteration 1 on the left would claim a `1 → N` comparison
  // instead, and the native Files tab, which reprojects the anchor into the
  // comparison the reader is looking at, would move a base-side comment onto the
  // source side. `changeTrackingId` comes from the same base-to-iteration change
  // list, so it only means anything alongside this.
  const iteration = Math.max(1, workspace.iterationId);
  const thread = {
    status: CommentThreadStatus.Active,
    comments: [{ content, commentType: CommentType.Text, parentCommentId: 0 }],
    threadContext,
    pullRequestThreadContext: {
      changeTrackingId: file.changeTrackingId,
      iterationContext: {
        firstComparingIteration: iteration,
        secondComparingIteration: iteration,
      },
    },
  } as GitPullRequestCommentThread;

  await gitClient().createThread(
    thread,
    workspace.repositoryId,
    workspace.id,
    workspace.projectId,
  );
}

export async function createReviewPlan(
  workspace: PullRequestWorkspace,
  planId: string,
  version: number,
  markdown: string,
): Promise<void> {
  // Every plan this extension writes opts in to `manual` invalidation: from here
  // on, feedback on a step outlives a revision of the plan around it. A plan
  // posted by hand or by a tool has to carry the field to get the same rule.
  const marker = formatMarker({
    kind: "review-plan",
    planId,
    version,
    invalidation: "manual",
  });
  const content = `${markdown.trim()}\n\n${marker}`;
  const thread = {
    status: CommentThreadStatus.Active,
    comments: [{ content, commentType: CommentType.Text, parentCommentId: 0 }],
  } as GitPullRequestCommentThread;

  await gitClient().createThread(
    thread,
    workspace.repositoryId,
    workspace.id,
    workspace.projectId,
  );
}

export async function replyToThread(
  workspace: PullRequestWorkspace,
  threadId: number,
  content: string,
): Promise<void> {
  await gitClient().createComment(
    { content, commentType: CommentType.Text, parentCommentId: 0 } as Comment,
    workspace.repositoryId,
    workspace.id,
    threadId,
    workspace.projectId,
  );
}

/**
 * Azure DevOps only lets an author edit their own comment; the UI hides the
 * action for everyone else, and the service enforces it regardless.
 */
export async function updateCommentContent(
  workspace: PullRequestWorkspace,
  threadId: number,
  commentId: number,
  content: string,
): Promise<void> {
  await gitClient().updateComment(
    { content } as Comment,
    workspace.repositoryId,
    workspace.id,
    threadId,
    commentId,
    workspace.projectId,
  );
}

export async function setThreadResolved(
  workspace: PullRequestWorkspace,
  threadId: number,
  resolved: boolean,
): Promise<void> {
  await gitClient().updateThread(
    { status: resolved ? CommentThreadStatus.Fixed : CommentThreadStatus.Active } as GitPullRequestCommentThread,
    workspace.repositoryId,
    workspace.id,
    threadId,
    workspace.projectId,
  );
}

export async function setCommentLiked(
  workspace: PullRequestWorkspace,
  threadId: number,
  commentId: number,
  liked: boolean,
): Promise<void> {
  const client = gitClient();
  const { repositoryId, id: pullRequestId, projectId } = workspace;
  if (liked) {
    await client.createLike(repositoryId, pullRequestId, threadId, commentId, projectId);
  } else {
    await client.deleteLike(repositoryId, pullRequestId, threadId, commentId, projectId);
  }
}

export interface CommentAttachment {
  name: string;
  url: string;
}

/**
 * Stores a file as an attachment of the pull request, which is where an image
 * pasted into a comment goes: the comment itself only carries a link to it, and
 * the attachment outlives every edit of the text around it.
 */
export async function uploadCommentAttachment(
  source: AttachmentSource,
  fileName: string,
  content: ArrayBuffer,
): Promise<CommentAttachment> {
  const client = gitClient();
  // Attachments are addressed by name within the pull request, and a second
  // upload under a taken name replaces the file behind it — which may be an
  // image somebody else's comment links to. Every screenshot arrives called
  // `image.png`, so the names already there are read first.
  const existing = await client.getAttachments(source.repositoryId, source.id, source.projectId);
  const name = uniqueAttachmentName(
    fileName,
    existing.map((attachment) => attachment.displayName),
  );
  const created = await client.createAttachment(
    content,
    name,
    source.repositoryId,
    source.id,
    source.projectId,
  );

  return { name, url: created.url };
}

/**
 * Reads an attachment back for display. The endpoint answers with the bytes and
 * no usable content type, so the media type is taken from the name.
 */
export async function loadCommentAttachment(
  source: AttachmentSource,
  fileName: string,
): Promise<Blob> {
  const content = await gitClient().getAttachmentContent(
    fileName,
    source.repositoryId,
    source.id,
    source.projectId,
  );

  return new Blob([content], { type: imageMediaType(fileName) ?? "application/octet-stream" });
}

/**
 * The identity's picture. `imageUrl` is the deprecated field and the `_links`
 * entry the current one, so the link wins and the old field is the fallback for
 * a server that still only sends it. Typed loosely because `_links` is `any` in
 * the API contract itself.
 */
function avatarHref(author: IdentityRef): string | undefined {
  const links = author._links as { avatar?: { href?: unknown } } | undefined;
  const href = links?.avatar?.href;
  return typeof href === "string" && href ? href : author.imageUrl || undefined;
}

function mapPullRequestState(status: PullRequestStatus): PullRequestState {
  switch (status) {
    case PullRequestStatus.Active:
      return "active";
    case PullRequestStatus.Completed:
      return "completed";
    case PullRequestStatus.Abandoned:
      return "abandoned";
    default:
      return "unknown";
  }
}

function mapReviewThread(thread: GitPullRequestCommentThread): ReviewThread {
  const context = thread.threadContext;
  const right = context?.rightFileStart;
  const left = context?.leftFileStart;
  const start = right ?? left;
  const end = right ? context.rightFileEnd : context?.leftFileEnd;

  return {
    id: thread.id,
    filePath: context?.filePath ? normalizeRepositoryPath(context.filePath) : undefined,
    status: thread.status,
    isOpen:
      thread.status === CommentThreadStatus.Active ||
      thread.status === CommentThreadStatus.Pending,
    position:
      start && end
        ? {
            side: right ? "right" : "left",
            startLine: start.line,
            startOffset: start.offset,
            endLine: end.line,
            endOffset: end.offset,
          }
        : undefined,
    comments: thread.comments
      .filter((comment) => !comment.isDeleted)
      .map((comment) => ({
        id: comment.id,
        authorId: comment.author.id,
        authorName: comment.author.displayName,
        authorImageUrl: avatarHref(comment.author),
        content: comment.content,
        publishedDate: comment.publishedDate.toISOString(),
        likeCount: comment.usersLiked?.length ?? 0,
        likedBy: comment.usersLiked?.map((identity) => identity.id) ?? [],
      })),
  };
}

async function getAllChanges(
  client: GitRestClient,
  repositoryId: string,
  pullRequestId: number,
  iterationId: number,
  projectId?: string,
): Promise<GitPullRequestChange[]> {
  const result: GitPullRequestChange[] = [];
  let skip = 0;
  let top = 2000;

  do {
    const page = await client.getPullRequestIterationChanges(
      repositoryId,
      pullRequestId,
      iterationId,
      projectId,
      top,
      skip,
      0,
    );
    result.push(...page.changeEntries);
    skip = page.nextSkip;
    top = page.nextTop;
  } while (skip > 0 && top > 0);

  return result;
}

/** Git's null object id: a deleted file carries it instead of an empty value. */
const emptyObjectId = "0".repeat(40);

/**
 * A deleted entry does not always describe itself through `item.path`, so every
 * field that can carry the path is consulted. Dropping such an entry would make
 * the file vanish from the review entirely.
 */
function changePath(change: GitPullRequestChange): string | undefined {
  return change.item?.path || change.sourceServerItem || change.originalPath || undefined;
}

function blobId(objectId: string | undefined): string | undefined {
  return objectId && objectId !== emptyObjectId ? objectId : undefined;
}

function mapChangedFile(change: GitPullRequestChange): ChangedFile {
  return {
    path: normalizeRepositoryPath(changePath(change) ?? ""),
    originalPath: change.originalPath
      ? normalizeRepositoryPath(change.originalPath)
      : undefined,
    objectId: blobId(change.item?.objectId),
    originalObjectId: blobId(change.item?.originalObjectId),
    changeTrackingId: change.changeTrackingId,
    changeKind: classifyFileChange(change.changeType),
  };
}

function selectAuthorizedPlan(
  threads: readonly GitPullRequestCommentThread[],
  authorId: string,
): GitPullRequestCommentThread | undefined {
  return threads
    .filter((thread) => !thread.isDeleted && !thread.threadContext?.filePath)
    .filter((thread) => thread.comments[0]?.author.id === authorId)
    .map((thread) => ({ thread, marker: parsePlanMarker(thread.comments[0]?.content ?? "") }))
    .filter((candidate) => candidate.marker)
    .sort((left, right) => {
      const versionOrder = (right.marker?.version ?? 0) - (left.marker?.version ?? 0);
      return versionOrder || right.thread.id - left.thread.id;
    })[0]?.thread;
}

function shortBranchName(refName: string): string {
  return refName.replace(/^refs\/heads\//, "");
}

async function getTextBlob(
  client: GitRestClient,
  repositoryId: string,
  objectId: string | undefined,
  projectId: string | undefined,
): Promise<string> {
  if (!objectId) {
    return "";
  }

  const content = await client.getBlobContent(repositoryId, objectId, projectId);
  if (content.byteLength > 1024 * 1024) {
    throw new Error("This file is larger than the 1 MB diff limit.");
  }

  const bytes = new Uint8Array(content);
  if (bytes.includes(0)) {
    throw new Error("Binary files cannot be displayed in the diff viewer.");
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("This file is not valid UTF-8 text.");
  }
}
