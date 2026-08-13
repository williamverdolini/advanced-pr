export type FileChangeKind = "add" | "edit" | "delete" | "rename";

/**
 * `VersionControlChangeType` is a flags enum, so a rename arrives as
 * `Rename | Edit` and an undelete as `Undelete | Add`. Testing bits in this
 * order keeps the classification stable for the combinations Azure DevOps
 * actually emits on a pull request.
 */
const flags = {
  add: 1,
  edit: 2,
  rename: 8,
  delete: 16,
  undelete: 32,
  sourceRename: 1024,
  targetRename: 2048,
} as const;

export function classifyFileChange(changeType: number | undefined): FileChangeKind {
  const value = changeType ?? 0;
  const has = (flag: number): boolean => (value & flag) !== 0;

  if (has(flags.delete)) {
    return "delete";
  }
  if (has(flags.rename) || has(flags.sourceRename) || has(flags.targetRename)) {
    return "rename";
  }
  if (has(flags.add) || has(flags.undelete)) {
    return "add";
  }

  // Everything else (plain Edit, Encoding, Property) reads as a modification.
  return "edit";
}

/**
 * A file that exists on only one side has nothing to compare against: it is
 * shown as a plain read-only file instead of a diff. An added file shows its
 * new content, a deleted one what it used to hold.
 */
export function isContentOnlyChange(kind: FileChangeKind): boolean {
  return kind === "add" || kind === "delete";
}

/** Which side of the change carries the content worth reading. */
export function contentSideForChange(kind: FileChangeKind): "left" | "right" {
  return kind === "delete" ? "left" : "right";
}

export const changeKindLabels: Record<FileChangeKind, string> = {
  add: "Added",
  edit: "Modified",
  delete: "Deleted",
  rename: "Renamed",
};
