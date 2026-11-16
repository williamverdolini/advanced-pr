import { stableHash } from "../core/hash";
import {
  createViewedFileRevisions,
  reconcileViewedFiles,
  type ViewedFileRevisions,
} from "../core/viewedFiles";
import type { PullRequestWorkspace } from "./azureDevOpsClient";
import { getExtensionDataManager, userScope } from "./extensionDataManager";

/**
 * The subset of the workspace this store needs. Narrower than the workspace so
 * callers can memoize it and avoid reloading after a thread-only refresh.
 */
export type ViewedFilesScope = Pick<
  PullRequestWorkspace,
  "id" | "repositoryId" | "projectId" | "files"
>;

export async function loadViewedFiles(
  workspace: ViewedFilesScope,
): Promise<ReadonlySet<string>> {
  const key = storageKey(workspace);
  try {
    const manager = await getExtensionDataManager();
    const revisions = await manager.getValue<ViewedFileRevisions>(key, {
      ...userScope,
      defaultValue: {},
    });
    return reconcileViewedFiles(workspace.files, revisions ?? {});
  } catch {
    return reconcileViewedFiles(workspace.files, readLocal(key));
  }
}

export async function saveViewedFiles(
  workspace: ViewedFilesScope,
  paths: ReadonlySet<string>,
): Promise<void> {
  const key = storageKey(workspace);
  const revisions = createViewedFileRevisions(workspace.files, paths);
  try {
    const manager = await getExtensionDataManager();
    await manager.setValue(key, revisions, userScope);
  } catch {
    window.localStorage.setItem(key, JSON.stringify(revisions));
  }
}

function storageKey(workspace: ViewedFilesScope): string {
  const identity = [
    workspace.projectId ?? "project",
    workspace.repositoryId,
    workspace.id,
  ].join(":");
  return `viewed-files-${stableHash(identity)}`;
}

function readLocal(key: string): ViewedFileRevisions {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return isViewedFileRevisions(value) ? value : {};
  } catch {
    return {};
  }
}

function isViewedFileRevisions(value: unknown): value is ViewedFileRevisions {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.values(value).every((revision) => typeof revision === "string"),
  );
}