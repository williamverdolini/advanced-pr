# Changelog

## 0.7.0

Feedback that survives the plan.

- **A step's feedback no longer decays on its own.** Approvals and change requests used to be
  discarded as soon as the plan changed at all — reordering the steps, moving a file, even
  rewriting the notes of a step nobody had reviewed. A step is now identified by its title, so
  all of that leaves every decision standing. Feedback stops counting only when the step is
  renamed, when it is removed from the plan, or when the pull request author clears it.
- **The author can clear feedback**, on the selected step or on the whole review, from the `...`
  menu beside the step commands. The confirmation names everyone who loses a decision before
  anything is written, and the reset comment **mentions them**, so nobody finds their approval
  gone without being told. Nothing is deleted — the reset is one more comment and the decisions
  it clears stay readable — and no reviewer's vote is changed, because Azure DevOps only lets
  each reviewer set their own.
- **An image can be pasted into a comment.** A screenshot in the clipboard is uploaded as an
  attachment of the pull request and linked from the comment, the way the native Files tab does
  it, so it is part of the discussion in both interfaces — and it is rendered inline, in the
  live preview while writing and in the thread once posted. Text in the clipboard wins over an
  image beside it, which is what copying a range out of Excel puts there. Attachments are read
  back through the extension's own token, because a comment is rendered in an iframe where the
  browser sends no Azure DevOps cookie.
- Step ids are now readable: `step-sort-contract` instead of `step-a91f3c2d`, which is what the
  decision comments in the pull request carry.
- The plan marker is documented in the README, for the case where the first plan is posted by a
  script or an agent through the REST API rather than from the extension: it has to carry
  `"invalidation":"manual"` to get the rule above.
- **Pull requests already under review are untouched.** The rule is a property of the plan, not
  of this build: a plan carries `"invalidation":"manual"` in its marker to opt in, and one
  without the field keeps the original behaviour for good. A plan opts in the first time its
  author saves it from the extension — that one save clears the feedback recorded until then,
  and it is the last time that happens.

## 0.6.0

Reading a file with its context.

- **Related files under a file entry.** A bullet indented under another one in the plan names a
  file worth reading beside it, usually the test that covers it. The row shows a counter that
  expands into those files; each one opens in the diff, takes comments and carries its own
  viewed mark, which is the same mark the step listing it shows, so ticking it once is enough.
  They stay context rather than work: they do not count towards the step's file total, they
  still land in `Everything else` unless a step lists them on a line of their own, and adding
  or rewriting them never invalidates an approval already given.
- **Comment text can be selected** and copied. Monaco marks its own editor unselectable and
  re-enables it for the code lines alone, which left every comment in the diff impossible to
  select.
- **Reply & resolve** in one action, beside `Reply` — `Reply & reopen` on a thread that is
  already resolved.
- The thread's own `Reply` and `Resolve` buttons **step aside while the reply box is open**: the
  box offers the same actions, and a row kept above it costs height inside the diff.
- Comments and the `Explain` notes are set in **14px** instead of 12px, and the expanded
  `Explain` dialog in 15px: they are prose, and were being sized like the chrome around them.

## 0.5.2

- The **decisions icon** on a step turns amber as soon as any reviewer has asked for changes on
  it, so a step held up by somebody else is visible to everyone without opening the panel. The
  step number keeps speaking for the reviewer looking at it. The icon's tooltip and its
  accessible name now count both decisions, so the warning does not rest on colour alone.

## 0.5.1

- The files pane opens at **400px** instead of 280px, and **remembers the width** it was
  dragged to: the splitter position is written to the browser's local storage and read back on
  the next refresh, or the next time the tab is opened. A width outside the pane's limits, or
  one that cannot be read, falls back to 400px.

## 0.5.0

Reading the file tree.

- A file name too long for the tree is **cut with an ellipsis** instead of wrapping onto a
  second line, so every row is the same height and the list stays scannable. The full path is
  still on the row's tooltip.
- Folder rows are cut the same way, but only the name gives up width: the `viewed/total`
  counter beside it stays visible whatever the name's length.
- File names use the host's interface font, the same one the native **Files** tab uses, in
  place of the monospace face.

## 0.4.0

Moving through a file, and reading it.

- **Previous and next difference** in the file header, so a long file is walked by change
  rather than by scrolling. Disabled, with a reason, on files that have nothing to compare.
- Any line offers to be commented: hovering it shows a comment icon in the margin, replacing
  the "Comment on selection" command. One button covers both cases, because a live selection
  on the same side of the diff is what the comment anchors to, and the line clicked is used
  only when there is nothing selected.
- The file header shows the file name, with its folder underneath as a subtitle, instead of
  one long path.
- Entering a step lands on the first file **not yet marked as viewed**, in the order the tree
  shows them. It used to be the first file in the order the API returned, which is not the
  order on screen, so the selection appeared to fall in the middle of the list.
- The Explain panel starts closed.
- The file tree's scrollbar is thin and stays out of sight until the pointer is over it.

## 0.3.0

Who decided on each step, and a correction to the side a comment lands on.

- **Step decisions on demand**: a button on every decided step lists the reviewers, their
  decision and its date, read from the ledger like the rest of the review state.
- **Fixed**: a comment written on the base side appeared on the source side in the native Files
  tab. The anchor was right, the iteration comparison sent with it was not. Affected pull
  requests with more than one iteration; comments already stored keep their anchor.
- **Fixed**: `Changes requested` was a red step number and an orange menu icon. Both now use the
  host's warning colour, with dark text on the step number for legibility.
- **Fixed**: the sign-off warning counted the plan and the recorded decisions as open
  discussions, and once per plan version. Comments the extension writes are excluded; a real
  reply to the plan still counts.
- Marking files as viewed no longer writes when nothing changed.

### Internals

- `App.tsx` goes from 1409 lines to 109: one file per component, one hook per concern under
  `src/app/`. Behaviour-preserving by design, and the unit tests cover `core/` only, so the
  review flow needs a manual pass before promoting a build.
- New tested `core/` modules for logic that was inlined or duplicated: set membership, Monaco
  language by path, the comment marker. The event reducer also reports decisions per step.
- One Git REST client per session instead of one per call.
- `ARCHITECTURE.md` writes down the layer rule and where each kind of change belongs;
  `CLAUDE.md` carries the same invariants for agents.

## 0.2.0

Mentions in comments.

- Typing `@` in a comment opens a search over the whole organization, people and teams alike,
  with keyboard navigation and most-recently-used suggestions on an empty query. Picking
  someone also promotes them in the host's MRU, so the list learns from use.
- The comment toolbar is now icon-only: bold, italic, code, link, bulleted and numbered
  lists, and a button that starts a mention.
- The open file is kept in the host page's `path` query parameter, the same one the native
  Files tab uses. A refresh comes back to the same file and to the step that contains it, and
  moving between the two tabs keeps the place.
- `@<GUID>` mention tokens parsed and rendered as a chip carrying the person's name, instead
  of the raw identity id Azure DevOps stores in the comment text. The file tree shows the
  same names in its comment previews.
- Names resolved from the people already on the pull request, from anyone the picker has
  returned, and otherwise through the host's identity service, which searches the
  organization **without the extension requesting an identity scope of its own**.
- An identity that cannot be resolved renders as a neutral chip, never as a bare id.

- The editor shows a mention as `@Display Name` while Azure DevOps keeps storing `@<GUID>`:
  the two forms are converted on the way in and out. A name the editor cannot map back to an
  identity stays plain text rather than becoming a mention by accident, and a token whose
  identity cannot be resolved is left untouched rather than silently dropped.

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
