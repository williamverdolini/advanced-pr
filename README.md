# Advanced PR Review

An Azure DevOps web extension that adds a **Guided Review** tab to every pull request, for reviews that are too large to read in one sitting.

## Why this exists

Yes, big pull requests are a bad practice. I know. Split the work, keep each change small and self-contained, and everyone's life gets easier. That advice is right, and I am not arguing with it.

It just keeps not happening. AI-assisted development on a large codebase tends to carry a change all the way through: the feature, the call sites it breaks, the tests, the fixtures, the tooling that had to follow, the docs that went stale. Cutting that apart into pull requests that are each autonomous *and* each internally consistent is sometimes possible, often expensive, and occasionally a bit of a fiction: three pull requests that only make sense once all three are merged aren't three reviews, they're one review wearing a disguise.

So the problem worth solving isn't "make the pull request smaller". It's that **a reviewer has a limited budget of attention, and it should be spent where it changes the outcome.** The domain logic, the tricky boundary, the thing that will be hard to undo later: that deserves the budget. The regenerated fixtures, the baseline update, the tooling bump, the documentation pass: those deserve a glance, not a read, and pretending otherwise is how the important part ends up getting the tired half of someone's afternoon.

That's what this extension is for. The author says, in the pull request itself, which blocks actually matter and in what order to read them, with a note explaining why, while everything else lands at the end, in one step, to be acknowledged rather than studied.

Focus on what actually counts.

## What it does

Instead of one long list of changed files, the reviewer works through one step at a time. Every decision is written back as a real pull request comment, so the classic Azure DevOps interface keeps showing the whole story. There is **no backend, no database, and no stored credential** anywhere in the design.

**Splits the review into steps.** The author posts the plan as a comment on the pull request. Files not listed in any step fall into a final `Everything else` step, so nothing is left out. Without a plan the pull request has that one step, containing every file, and behaves exactly like any other step.

```markdown
1. Core
### Explain
Start from `engine.ts`: everything else follows from it.
- src/core/engine.ts
  - tests/engine.test.ts
- src/core/rules.ts

2. Tests
- tests/engine.test.ts
```

The `### Explain` block is optional and purely descriptive: it is shown above the file list, and editing it never invalidates approvals already given.

**Related files hang off a file entry.** A bullet indented under another one is a file worth reading *beside* it, typically the test that covers it: the row shows a counter that expands into the related files, each of them openable, commentable and markable as viewed like any other. They are context, not work, so they never count towards the step's file total, and a related file still lands in `Everything else` unless some step lists it on a line of its own. Adding or rewriting them never invalidates an approval, for the same reason `### Explain` does not.

**Puts comments inside the diff.** Threads render under the line they refer to, with reply, edit, like and resolve in place. Markdown is rendered, with a live preview while writing, and the comment icon in the margin opens and closes each thread. The file tree lists threads under their file, so the same selection drives the tree, the margin and the editor.

**Renders a diff that reads like the native one.** Monaco, unified by default with a side-by-side switch, following the host's light or dark theme. Added and deleted files are shown as plain content instead of a diff against nothing; the tree marks each file as added, modified, deleted or renamed, and tracks which ones you have viewed.

**Records approvals as comments.** Approving a step appends an event to a thread-ledger; a deterministic reducer rebuilds the review state from those comments on every load, which is why no database is needed. Approving the last step asks whether to approve the whole pull request, the only action that changes your Azure DevOps vote. A push that changes a step's files invalidates that step's approval and only that one.

## What it does not do yet

- **Reject the entire pull request** (`vote -10`): approvals and change requests only.
- **Build and policy checks**, and **linked work items**: read them in the native tabs.
- **Persist UI preferences** other than viewed files: diff layout and pane width reset with the session.

The behaviour that still requires validation in a real Azure DevOps organization is listed in the [implementation plan](docs/azdo-extension-feasibility-plan.md), which is also the technical reference for every design decision summarised here.

## Permissions and data

The extension is a static page that calls the Azure DevOps REST API from the browser **with the signed-in user's identity**: comments and votes are attributed to the real reviewer, and no token is stored anywhere.

| Scope | Why |
|---|---|
| `vso.code_write` | Read the pull request, its iterations and file contents; create comment threads; set the reviewer vote |
| `vso.threads_full` | Read and write comment threads, including likes |
| `vso.extension.data_write` | Store, per user, which files have been marked as viewed |

Scopes are deliberately kept to this set. Adding one invalidates the extension certificate and requires an administrator to reauthorize the installation, so any addition must be justified, tested in a test organization, and announced before publication. Never add PAT storage, service-account credentials or secrets to the client bundle.

---

# Contributing

The extension is published privately under the **NebulaImprover** publisher:

- Production extension: `NebulaImprover.advanced-pr`, manifest `vss-extension.json`, with `dist/` bundled.
- Development extension: `NebulaImprover.advanced-pr-dev`, with **two** manifests that take turns:
  - `vss-extension.dev.json` loads from `baseUri: https://localhost:3000`, for hot reload;
  - `vss-extension.dev-packaged.json` bundles `dist/` instead, to rehearse a release.

The rehearsal exists because `baseUri` never exercises how the packaged bundle resolves its assets from the Marketplace CDN, and Azure DevOps allows no sideloading: publishing is the only way to find out. Doing it on the development extension ID spends a throwaway version number instead of a production one.

Both development manifests share that one extension ID, and therefore **one version line**. They take turns on it: after publishing the packaged variant, going back to hot reload means bumping `vss-extension.dev.json` above the version just published, not republishing the number it still carries. The Marketplace rejects a version equal to or lower than the published one, and that rejection is the usual reason a republish "does nothing".

## 1. Prerequisites

1. Git and a current Node.js LTS release with npm.
2. Access to an Azure DevOps **test** organization. Never develop against the production one.
3. Contributor rights on the `NebulaImprover` publisher, to publish.
4. An organization administrator, or a user with **Manage extensions**, for the first installation.
5. A second test user, for the concurrent-reviewer scenarios.

## 2. Get the source

```powershell
git clone https://github.com/williamverdolini/advanced-pr.git
Set-Location advanced-pr
npm ci
```

Use `npm ci` rather than `npm install` for reproducible installs. Never commit `node_modules`, bundles, `.vsix` packages, certificates, tokens or local environment files; `.gitignore` already covers them.

## 3. Validate a change

```powershell
npm run lint
npm test
npm run build
```

Run all three before opening a pull request. Most of the value sits in the unit tests, because the parts worth testing are pure: plan parsing and canonical hashing, the event reducer and its idempotency, sign-off eligibility, inline zone layout, Markdown rendering, change-type classification and theme detection. Changes to comment anchors, votes or extension context also require a manual round-trip in the test organization, and that round-trip is the only thing that proves the integration is real.

## 4. Run it locally

Azure DevOps loads extensions in an iframe from an HTTPS origin, so local development goes through the development manifest and its `baseUri`.

```powershell
npm run dev
```

`npm run dev` and `npm run dev:watch` are equivalent: both start Vite in watch mode with hot module replacement on the fixed port `3000`. Keep one instance running; a second exits with "address already in use".

Then open `https://localhost:3000` once to trust the local certificate, open a pull request in the test organization, and select the **Guided Review (Dev)** tab. The development extension must have been published and installed once before Azure DevOps can load from `baseUri`; after that, source changes need no further upload unless the manifest itself changes.

If the tab is blank, check in this order: the dev server is serving `https://localhost:3000`, the certificate is trusted, and the iframe console shows no CSP or worker errors.

## 5. Package

```powershell
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.dev.json            # hot reload
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.dev-packaged.json   # rehearsal
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.json                # production
```

Confirm in the output that publisher, extension ID and version are the expected ones. Every Marketplace update needs a version higher than the published one; versions cannot be rolled back by uploading an older package, so a faulty release is fixed by publishing a higher one.

## 6. Publish

Publishing asks for a PAT with the **Marketplace (publish)** scope. Create it short-lived, paste it **only** at the `Personal access token:` prompt, and keep it out of source control, npm scripts, command arguments, shell history and documentation.

```powershell
npx --package tfx-cli tfx extension publish `
	--publisher NebulaImprover `
	--manifest-globs vss-extension.dev.json `
	--share-with <organization-name> `
	--rev-version
```

`--rev-version` bumps and writes the manifest patch version even if a later step fails: review the manifest change before retrying, and commit it deliberately.

Sharing only makes a private extension visible; it does not install it. From the extension page, select **Get it free**, choose the organization and install; an administrator must approve. Verify under **Organization settings → Extensions**.

## 7. Before promoting a change

Test at least these, and verify every write in the standard Azure DevOps pull request interface as well as in the tab:

1. Pull request with a valid plan, with no plan, and with a plan posted by someone who is not the author.
2. Two reviewers writing to the same ledger concurrently.
3. Timeout and retry with the same event ID, producing no duplicate state.
4. Comments anchored on both sides of the diff, still correct after another iteration.
5. `Request changes` on several steps, checking that vote `-5` is not cleared too early.
6. Sign-off after the last step, and after resetting a step.
7. Added, renamed and deleted files, and more than one page of changes.
8. Binary, very large and unsupported-encoding files.
9. A pull request with 100+ changed files: navigation time and browser memory.
