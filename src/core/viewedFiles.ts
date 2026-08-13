export interface RevisionedFile {
  path: string;
  objectId?: string;
  originalObjectId?: string;
}

export type ViewedFileRevisions = Record<string, string>;

export function reconcileViewedFiles(
  files: readonly RevisionedFile[],
  storedRevisions: ViewedFileRevisions,
): ReadonlySet<string> {
  return new Set(
    files
      .filter((file) => storedRevisions[file.path] === fileRevision(file))
      .map((file) => file.path),
  );
}

export function createViewedFileRevisions(
  files: readonly RevisionedFile[],
  viewedPaths: ReadonlySet<string>,
): ViewedFileRevisions {
  return Object.fromEntries(
    files
      .filter((file) => viewedPaths.has(file.path))
      .map((file) => [file.path, fileRevision(file)]),
  );
}

export function fileRevision(file: RevisionedFile): string {
  return file.objectId ?? `deleted:${file.originalObjectId ?? "unknown"}`;
}