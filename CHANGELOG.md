# Changelog

## 0.1.0

First private release of the **Guided Review** tab for Azure DevOps pull requests.

### Review flow

- Review plan posted as a pull request comment, parsed into ordered steps, with an authorized `advanced-pr:v2` marker and a canonical hash that survives cosmetic edits.
- Optional `### Explain` block per step, rendered above the file list and expandable into a larger view. Editing it never invalidates approvals.
- Final `Everything else` step collecting every file no step claims. A pull request without a plan simply has that one step and behaves like any other.
- Per-step approvals, change requests and resets, recorded as append-only comment events and replayed by a deterministic reducer, so no database is involved.
- Explicit pull request sign-off, offered once every step that needs approval has it. It is the only action that changes the Azure DevOps vote.
- Selective invalidation: a push invalidates the approval of the steps whose files actually changed.

### Files and diff

- Monaco diff, unified by default with a side-by-side switch, following the host's light or dark theme.
- Added and deleted files shown as plain content instead of a diff against nothing, from the side that holds the content.
- File tree with change-type indicators (added, modified, deleted, renamed), deleted names struck through, viewed-file tracking, and a resizable splitter.

### Comments

- Threads rendered inline in the diff, under the line they refer to, with reply, edit, like and resolve in place.
- Markdown rendered without `dangerouslySetInnerHTML`, with a live preview while writing and an allowlist for link schemes.
- Comment icon in the glyph margin toggles a thread; the file tree lists threads under their file, sharing one selection with the margin and the editor.
- New comments from a code selection or from the margin, anchored to the correct side of the diff.

### Not included yet

- Rejecting the entire pull request.
- Build and policy checks, and linked work items.
- Persisted UI preferences other than viewed files.
