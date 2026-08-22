export interface FileTreeFile<TFile extends { path: string } = { path: string }> {
  kind: "file";
  name: string;
  path: string;
  file: TFile;
}

export type FileTreeNode<TFile extends { path: string } = { path: string }> =
  | FileTreeFolder<TFile>
  | FileTreeFile<TFile>;

export interface FileTreeFolder<TFile extends { path: string } = { path: string }> {
  kind: "folder";
  name: string;
  path: string;
  children: FileTreeNode<TFile>[];
  filePaths: string[];
}

interface MutableFolder<TFile extends { path: string }> {
  name: string;
  path: string;
  folders: Map<string, MutableFolder<TFile>>;
  files: FileTreeFile<TFile>[];
}

export function buildFileTree<TFile extends { path: string }>(
  files: readonly TFile[],
): FileTreeNode<TFile>[] {
  const root: MutableFolder<TFile> = {
    name: "",
    path: "",
    folders: new Map(),
    files: [],
  };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const fileName = segments.pop() ?? file.path;
    let folder = root;

    for (const segment of segments) {
      const path = folder.path ? `${folder.path}/${segment}` : segment;
      let child = folder.folders.get(segment);
      if (!child) {
        child = { name: segment, path, folders: new Map(), files: [] };
        folder.folders.set(segment, child);
      }
      folder = child;
    }

    folder.files.push({ kind: "file", name: fileName, path: file.path, file });
  }

  return materializeChildren(root);
}

/**
 * Files in the order the tree shows them: folders first, then files, both by
 * name. It is not the order the API returns them in, which is why picking "the
 * first file" from the raw list lands somewhere in the middle of the list the
 * reviewer is looking at.
 */
export function collectFiles<TFile extends { path: string }>(
  nodes: readonly FileTreeNode<TFile>[],
): TFile[] {
  return nodes.flatMap((node) =>
    node.kind === "file" ? [node.file] : collectFiles(node.children),
  );
}

/**
 * Where a reviewer should land when entering a step: the first file they have
 * not marked as viewed, or the first one when everything has been seen.
 */
export function nextFileToReview<TFile extends { path: string }>(
  files: readonly TFile[],
  viewed: ReadonlySet<string>,
): TFile | undefined {
  const ordered = collectFiles(buildFileTree(files));
  return ordered.find((file) => !viewed.has(file.path)) ?? ordered[0];
}

/**
 * The file before or after another in the order the tree shows them. It is what
 * a "previous/next file" command steps through, and it walks the same order the
 * reviewer sees rather than the order the API returned. Undefined at either end:
 * the step is a list, not a carousel, and wrapping around hides that it ended.
 */
export function adjacentFile<TFile extends { path: string }>(
  files: readonly TFile[],
  path: string | undefined,
  direction: "previous" | "next",
): TFile | undefined {
  const ordered = collectFiles(buildFileTree(files));
  const current = path ? ordered.findIndex((file) => file.path === path) : -1;
  // Nothing open yet: only "next" means something, and it means the first file.
  if (current < 0) {
    return direction === "next" ? ordered[0] : undefined;
  }

  return ordered[current + (direction === "next" ? 1 : -1)];
}

export function collectFolderPaths<TFile extends { path: string }>(
  nodes: readonly FileTreeNode<TFile>[],
): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [node.path, ...collectFolderPaths(node.children)]
      : [],
  );
}

/** The last segment of a repository path: the file name, without its folders. */
export function fileNameFromPath(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function materializeChildren<TFile extends { path: string }>(
  folder: MutableFolder<TFile>,
): FileTreeNode<TFile>[] {
  const folders: FileTreeFolder<TFile>[] = [...folder.folders.values()]
    .sort((left, right) => compareNames(left.name, right.name))
    .map((child) => {
      const children = materializeChildren(child);
      return {
        kind: "folder",
        name: child.name,
        path: child.path,
        children,
        filePaths: collectFilePaths(children),
      };
    });
  const files = [...folder.files].sort((left, right) => compareNames(left.name, right.name));
  return [...folders, ...files];
}

function collectFilePaths<TFile extends { path: string }>(
  nodes: readonly FileTreeNode<TFile>[],
): string[] {
  return nodes.flatMap((node) =>
    node.kind === "file" ? [node.path] : node.filePaths,
  );
}

function compareNames(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}
