import * as React from "react";
import { Button } from "azure-devops-ui/Button";
import { Checkbox, TriStateCheckbox } from "azure-devops-ui/Checkbox";
import { changeKindLabels, type FileChangeKind } from "../core/changeType";
import { toPlainText } from "../core/markdown";
import {
  buildFileTree,
  collectFolderPaths,
  type FileTreeNode,
} from "../core/fileTree";
import { toggleMember } from "../core/toggleSet";
import type { ChangedFile, ReviewThread } from "../platform/azureDevOpsClient";
import { MentionContext } from "./mentionContext";

export interface FileTreeProps {
  files: readonly ChangedFile[];
  viewedFiles: ReadonlySet<string>;
  selectedFile?: ChangedFile;
  selectedThreadId?: number;
  threadsByFile: ReadonlyMap<string, readonly ReviewThread[]>;
  onSelectFile: (file: ChangedFile) => void;
  onSelectThread: (file: ChangedFile, thread: ReviewThread) => void;
  onSetViewed: (paths: readonly string[], viewed: boolean) => void;
}

export function FileTree({
  files,
  viewedFiles,
  selectedFile,
  selectedThreadId,
  threadsByFile,
  onSelectFile,
  onSelectThread,
  onSetViewed,
}: FileTreeProps): React.ReactElement {
  const nodes = buildFileTree(files);
  const [expandedFolders, setExpandedFolders] = React.useState<ReadonlySet<string>>(
    () => new Set(collectFolderPaths(nodes)),
  );

  const toggleFolder = (path: string): void => {
    setExpandedFolders((current) => toggleMember(current, path));
  };

  return (
    <ul
      className="file-tree custom-scrollbar scroll-auto-hide"
      role="tree"
      aria-label="Changed files"
    >
      <TreeNodes
        nodes={nodes}
        level={1}
        expandedFolders={expandedFolders}
        viewedFiles={viewedFiles}
        selectedFile={selectedFile}
        selectedThreadId={selectedThreadId}
        threadsByFile={threadsByFile}
        onSelectFile={onSelectFile}
        onSelectThread={onSelectThread}
        onSetViewed={onSetViewed}
        onToggleFolder={toggleFolder}
      />
    </ul>
  );
}

const changeKindGlyphs: Record<FileChangeKind, string> = {
  add: "+",
  edit: "±",
  delete: "−",
  rename: "→",
};

function ChangeKindBadge({ kind }: { kind: FileChangeKind }): React.ReactElement {
  return (
    <span
      className={`change-badge change-badge-${kind}`}
      role="img"
      aria-label={changeKindLabels[kind]}
    >
      {changeKindGlyphs[kind]}
    </span>
  );
}

interface TreeNodesProps {
  nodes: readonly FileTreeNode<ChangedFile>[];
  level: number;
  expandedFolders: ReadonlySet<string>;
  viewedFiles: ReadonlySet<string>;
  selectedFile?: ChangedFile;
  selectedThreadId?: number;
  threadsByFile: ReadonlyMap<string, readonly ReviewThread[]>;
  onSelectFile: (file: ChangedFile) => void;
  onSelectThread: (file: ChangedFile, thread: ReviewThread) => void;
  onSetViewed: (paths: readonly string[], viewed: boolean) => void;
  onToggleFolder: (path: string) => void;
}

function TreeNodes({
  nodes,
  level,
  expandedFolders,
  viewedFiles,
  selectedFile,
  selectedThreadId,
  threadsByFile,
  onSelectFile,
  onSelectThread,
  onSetViewed,
  onToggleFolder,
}: TreeNodesProps): React.ReactElement {
  const resolveMention = React.useContext(MentionContext);

  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "file") {
          const fileThreads = threadsByFile.get(node.path) ?? [];
          return (
            <li
              className="file-tree-item"
              key={node.path}
              role="treeitem"
              aria-level={level}
            >
              <div
                className={
                  selectedFile?.path === node.path
                    ? "file-tree-row selected"
                    : "file-tree-row"
                }
                style={{ paddingLeft: `${(level - 1) * 14 + 8}px` }}
              >
                <span className="file-tree-spacer" />
                <Checkbox
                  ariaLabel={`Mark ${node.path} as viewed`}
                  checked={viewedFiles.has(node.path)}
                  onChange={(_event, checked) => onSetViewed([node.path], checked)}
                />
                <button
                  className={selectedFile?.path === node.path ? "file-tree-file selected" : "file-tree-file"}
                  type="button"
                  title={`${changeKindLabels[node.file.changeKind]} · ${node.path}`}
                  onClick={() => onSelectFile(node.file)}
                >
                  <ChangeKindBadge kind={node.file.changeKind} />
                  <span
                    className={
                      node.file.changeKind === "delete"
                        ? "file-tree-name deleted"
                        : "file-tree-name"
                    }
                  >
                    {node.name}
                  </span>
                </button>
                {fileThreads.length > 0 && (
                  <span className="file-thread-count" title={`${fileThreads.length} comments`}>
                    {fileThreads.length}
                  </span>
                )}
              </div>
              {fileThreads.length > 0 && (
                <ul className="file-thread-list" role="group">
                  {fileThreads.map((thread) => {
                    const lastComment = thread.comments.at(-1);
                    // A summary line, so mention tokens are reduced to names
                    // rather than shown as raw identity ids.
                    const preview = lastComment
                      ? toPlainText(lastComment.content, resolveMention)
                      : undefined;
                    return (
                      <li key={thread.id} role="treeitem" aria-level={level + 1}>
                        <button
                          type="button"
                          className={
                            selectedThreadId === thread.id
                              ? "file-thread-button selected"
                              : "file-thread-button"
                          }
                          title={preview ?? `Comment ${thread.id}`}
                          onClick={() => onSelectThread(node.file, thread)}
                        >
                          <span
                            className={thread.isOpen ? "thread-state open" : "thread-state resolved"}
                            aria-label={thread.isOpen ? "Open comment" : "Resolved comment"}
                          />
                          <span className="file-thread-line">
                            L{thread.position?.startLine ?? "?"}
                          </span>
                          <span className="file-thread-preview">
                            {preview || "Comment"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        }

        const expanded = expandedFolders.has(node.path);
        const viewedCount = node.filePaths.filter((path) => viewedFiles.has(path)).length;
        const allViewed = viewedCount === node.filePaths.length;
        const partiallyViewed = viewedCount > 0 && !allViewed;

        return (
          <li
            className="file-tree-item"
            key={node.path}
            role="treeitem"
            aria-level={level}
            aria-expanded={expanded}
          >
            <div className="file-tree-row" style={{ paddingLeft: `${(level - 1) * 14 + 8}px` }}>
              <Button
                className="file-tree-expand"
                subtle
                iconProps={{ iconName: expanded ? "ChevronDown" : "ChevronRight" }}
                tooltipProps={{ text: expanded ? `Collapse ${node.name}` : `Expand ${node.name}` }}
                onClick={() => onToggleFolder(node.path)}
              />
              <TriStateCheckbox
                ariaLabel={`Mark files in ${node.path} as viewed`}
                checked={partiallyViewed ? undefined : allViewed}
                onChange={() => onSetViewed(node.filePaths, !allViewed)}
              />
              <button
                className="file-tree-folder"
                type="button"
                title={node.path}
                onClick={() => onToggleFolder(node.path)}
              >
                <span className="file-tree-folder-name">{node.name}</span>
                <small>{viewedCount}/{node.filePaths.length}</small>
              </button>
            </div>
            {expanded && (
              <ul role="group">
                <TreeNodes
                  nodes={node.children}
                  level={level + 1}
                  expandedFolders={expandedFolders}
                  viewedFiles={viewedFiles}
                  selectedFile={selectedFile}
                  selectedThreadId={selectedThreadId}
                  threadsByFile={threadsByFile}
                  onSelectFile={onSelectFile}
                  onSelectThread={onSelectThread}
                  onSetViewed={onSetViewed}
                  onToggleFolder={onToggleFolder}
                />
              </ul>
            )}
          </li>
        );
      })}
    </>
  );
}