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

export function collectFolderPaths<TFile extends { path: string }>(
  nodes: readonly FileTreeNode<TFile>[],
): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [node.path, ...collectFolderPaths(node.children)]
      : [],
  );
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