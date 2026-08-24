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

**Puts comments inside the diff.** Threads render under the line they refer to, with reply, edit, like, share and resolve in place, and replying and resolving in one action. Markdown is rendered, with a live preview while writing, and the comment icon in the margin opens and closes each thread. An image pasted into a comment is uploaded as a pull request attachment and linked from the text, the way the native Files tab does it, so the screenshot is part of the discussion in both interfaces. The file tree lists threads under their file, so the same selection drives the tree, the margin and the editor.

**Links back to a comment.** Every comment carries a share icon, beside its author and date, which copies a link to the pull request with the Guided Review tab, the file, the thread and the comment in the query string. Whoever opens it lands on the right step and file, with the discussion scrolled to the top of the diff and the comment that was linked flashing once.

**Works on a phone.** Below 860px the file tree moves out of the splitter into a panel over the diff, opened from the counter in the toolbar and closed by picking a file; the step strip becomes a menu that lists every step with its full title; the diff is unified with long lines wrapped. A full-screen button hands the whole page to the tab, which is what makes the review readable on a screen where the tab is otherwise a few hundred pixels tall.

**Renders a diff that reads like the native one.** Monaco, unified by default with a side-by-side switch, following the host's light or dark theme. Added and deleted files are shown as plain content instead of a diff against nothing, with a deleted file's name struck through in the header; the tree marks each file as added, modified, deleted or renamed, and tracks which ones you have viewed — from the tree, or from the `Viewed` checkbox beside the file's own commands.

**Records approvals as comments.** Approving a step appends an event to a thread-ledger; a deterministic reducer rebuilds the review state from those comments on every load, which is why no database is needed. Approving the last step asks whether to approve the whole pull request — as `Approved` or `Approved with suggestions` — the only action that changes your Azure DevOps vote.

**Feedback on a step outlives the plan around it.** A step is identified by its title, so reordering the steps, revising which files a step lists, or rewriting its notes leaves every decision standing. Feedback stops counting in exactly three cases:

- the step is **renamed**, which makes it a different step — two steps sharing a title are numbered apart, and warned about;
- the step is **removed** from the plan;
- the pull request **author clears it**, on one step or on the whole review, from the `...` menu beside the step commands.

A rename or a removal is silent, because the plan says what it says. A reset is not: it writes a comment **mentioning everyone whose decision it discards**, so nobody finds their approval gone without being told. Nothing is ever deleted — a reset is one more comment, and the decisions it clears stay readable in the pull request. Reviewer votes are never touched, because Azure DevOps only lets each reviewer set their own.

Pull requests whose plan predates this rule keep the original one, where any change to the plan discards every decision. A plan moves to the new rule the first time its author saves it from the extension; that one save clears the feedback recorded until then, and it is the last time that happens.

### Writing the plan from outside the extension

The plan is a plain pull request comment: anything that can post a comment as the pull request author can create it, an agent using the REST API included. What makes it a plan is the trailing marker, which must declare the invalidation rule to get the behaviour above:

```html
<!-- advanced-pr:v2 {"kind":"review-plan","planId":"550e8400-e29b-41d4-a716-446655440000","version":1,"invalidation":"manual"} -->
```

`planId` is any stable identifier — a fresh GUID for a new plan, the same one when revising it, with `version` incremented. Without `"invalidation":"manual"` the plan is read under the original rule, so a tool that omits the field silently gives up the guarantee.

## What it does not do yet

- **Reject the entire pull request** (`vote -10`): approvals and change requests only.
- **Build and policy checks**, and **linked work items**: read them in the native tabs.
- **Persist UI preferences** other than viewed files and the files pane width: the diff layout resets with the session.

The behaviour that still requires validation in a real Azure DevOps organization is listed in the [implementation plan](docs/azdo-extension-feasibility-plan.md), which is also the technical reference for every design decision summarised here.

## Permissions and data

The extension is a static page that calls the Azure DevOps REST API from the browser **with the signed-in user's identity**: comments and votes are attributed to the real reviewer, and no token is stored anywhere.

| Scope | Why |
|---|---|
| `vso.code_write` | Read the pull request, its iterations and file contents; create comment threads; upload and read the attachments images in comments are stored as; set the reviewer vote |
| `vso.threads_full` | Read and write comment threads, including likes |
| `vso.extension.data_write` | Store, per user, which files have been marked as viewed |

Scopes are deliberately kept to this set. Adding one invalidates the extension certificate and requires an administrator to reauthorize the installation, so any addition must be justified, tested in a test organization, and announced before publication. Never add PAT storage, service-account credentials or secrets to the client bundle.

---

# Contributing

The extension is published privately under the **NebulaImprover** publisher:

- Production extension: `NebulaImprover.advanced-pr`, manifest `vss-extension.json`, with `dist/` bundled.
- Development extension: `NebulaImprover.advanced-pr-dev`, with **three** manifests that take turns:
  - `vss-extension.dev.json` loads from `baseUri: https://<dev-machine-address>:3000`, for hot reload **from any device on the network, this one included**. The one to reach for: a phone and the desktop read the same tab from the same dev server;
  - `vss-extension.dev-localhost.json` loads from `baseUri: https://localhost:3000` instead, for a desktop-only session that wants nothing to do with the network or its certificate;
  - `vss-extension.dev-packaged.json` bundles `dist/` instead of loading from a `baseUri` at all, to rehearse a release.

The rehearsal exists because `baseUri` never exercises how the packaged bundle resolves its assets from the Marketplace CDN, and Azure DevOps allows no sideloading: publishing is the only way to find out. Doing it on the development extension ID spends a throwaway version number instead of a production one.

All three share that one extension ID, and therefore **one version line** — which is the point of them sharing it: one extension, one installation, one tab in the pull request, and switching where it loads from is a publish rather than a second thing installed for everyone to see. They take turns on the line: whichever manifest is published next needs a version above the last one published for the ID, from whatever file that was. The Marketplace rejects a version equal to or lower than the published one, and that rejection is the usual reason a republish "does nothing", because the number a manifest still carries is the number it was published with.

The number sitting in a manifest is only worth something once that file has been published — `--rev-version` writes the bump back into the file it published, and into no other. So a sibling manifest's version says nothing about where the ID is: read that off the extension's Marketplace page before publishing a manifest that has been idle for a few rounds.

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

Azure DevOps loads extensions in an iframe from an HTTPS origin, so local development goes through a development manifest and its `baseUri`.

```powershell
npm run dev
```

One Vite instance, in watch mode with hot module replacement, on the fixed port `3000`, listening on **every interface**: it prints one line per address it bound, `https://localhost:3000` among them. Keep one instance running; a second exits with "address already in use". `npm run dev:local` binds the loopback alone, for a session that has no reason to be reachable.

That one server answers both names the development manifests use, so which one a tab loads from is decided by the manifest that was published, never by what is running:

- `vss-extension.dev.json`, on the machine's **network address**, is the one to publish by default. The phone reaches it, and so does the desktop — the address is the desktop's own. One tab, both devices, one hot-reload channel; the price is the certificate step below, on the desktop too.
- `vss-extension.dev-localhost.json`, on `localhost`, when the session is desktop-only and the certificate exception is not worth granting again. Nothing else differs.

Then open the `baseUri` origin once in an ordinary tab to accept its certificate, open a pull request in the test organization, and select the **Guided Review (Dev)** tab. The development extension must have been published and installed once before Azure DevOps can load from `baseUri`; after that, source changes need no further upload — only a change to the manifest itself does, which is what switching between those two is.

If the tab is blank, check in this order: the dev server bound the name the published `baseUri` uses, that origin's certificate has been accepted in this browser (see [Trusting the certificate](#trusting-the-certificate-on-every-device-that-loads-it) — a rejected one blocks the frame silently), and the iframe console shows no CSP or worker errors.

### From a phone

`localhost` on a phone is the phone, and an extension has exactly one `baseUri`, so a tab a phone can load is a tab that loads from the machine's address on the network. Which is also an address the desktop can load — that is why `vss-extension.dev.json` carries it, and why it is the manifest to publish unless there is a reason not to: one publish, one tab, and the phone and the desktop read the same code from the same server as it is saved.

Once, before the first run of that manifest:

1. Put this machine's address in its `baseUri` (`https://192.168.1.10:3000`), then publish it. `npm run dev` prints every address it bound, one line per interface: the one to take is the physical adapter's, not the `vEthernet` addresses Hyper-V and WSL contribute — nothing off this machine routes to those.
2. Allow inbound `3000` on the **private** network in Windows Firewall.
3. Accept the certificate, on the phone and on the desktop both — a step of its own, below.

The address is baked into a published manifest, so a DHCP lease that moves this machine costs an edit, a version bump and a republish. A static reservation for the development machine pays for itself after the first move. Publishing `vss-extension.dev-localhost.json` is the way back to a loopback-only session in the meantime.

#### Trusting the certificate on every device that loads it

The certificate `@vitejs/plugin-basic-ssl` generates covers `localhost`, `127.0.0.1` and `::1` — never the machine's address on the network. Every browser loading from `https://<address>:3000` therefore fails the name check, and **a subframe whose certificate is rejected is blocked with no interstitial**: no warning, no error, a tab that stays blank.

The exception has to be granted in a top-level tab first, on **each device and each browser profile** that opens the tab — the desktop included, whenever the published manifest is the network one: an exception granted for `localhost` does not carry over, because it is a different origin. This is the whole cost of one tab serving both devices, and the reason `vss-extension.dev-localhost.json` still exists.

1. Open `https://<address>:3000/index.html` in an ordinary tab.
2. Take the warning's **Advanced → Proceed to the address (unsafe)**.
3. Reload the pull request; the iframe now loads.

Chrome forgets these exceptions on some restarts, so a tab that goes blank again after one is usually this and not the code.

To be rid of it, issue one certificate covering both names — `mkcert localhost 127.0.0.1 ::1 192.168.1.10` — hand the pair to `server.https` in `vite.config.ts` in place of `basicSsl`, and install the local CA on every device that loads the tab. One server answers both origins, so one certificate covering both is enough whichever manifest is published. Keep the `.pem` files out of the repository; `.gitignore` already covers them.

The other way out, when none of this is worth it, is to publish `vss-extension.dev-packaged.json`: it serves the built bundle from the Marketplace CDN, so any device reaches it with no network setup and no certificate of ours, at the cost of a build and a publish per change.

## 5. Package

```powershell
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.dev.json             # hot reload, desktop and phone
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.dev-localhost.json   # hot reload, this desktop alone
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.dev-packaged.json    # rehearsal
npx --package tfx-cli tfx extension create --manifest-globs vss-extension.json                 # production
```

Confirm in the output that publisher, extension ID and version are the expected ones. The three development manifests share both, so the `.vsix` they write is named the same whenever their versions agree: packaging two of them in a row leaves one file on disk and no way to tell which manifest built it. Publishing reads the manifest directly, so this only matters when a `.vsix` is being inspected or uploaded by hand. Every Marketplace update needs a version higher than the published one; versions cannot be rolled back by uploading an older package, so a faulty release is fixed by publishing a higher one.

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

Swap `--manifest-globs` for any of the four. A development manifest only needs republishing when the manifest itself changes — a new `baseUri` after a DHCP move, or a switch between the network and `localhost` variants — never because the source changed.

Sharing only makes a private extension visible; it does not install it. From the extension page, select **Get it free**, choose the organization and install; an administrator must approve. Verify under **Organization settings → Extensions**.

## 7. Before promoting a change

Test at least these, and verify every write in the standard Azure DevOps pull request interface as well as in the tab:

1. Pull request with a valid plan, with no plan, and with a plan posted by someone who is not the author.
2. Two reviewers writing to the same ledger concurrently.
3. Timeout and retry with the same event ID, producing no duplicate state.
4. Comments anchored on both sides of the diff, still correct after another iteration.
5. `Request changes` on several steps, checking that vote `-5` is not cleared too early.
6. Sign-off after the last step, and after resetting a step, with both `Approve` (vote `10`) and `Approve with suggestions` (vote `5`).
7. Added, renamed and deleted files, and more than one page of changes.
8. Binary, very large and unsupported-encoding files.
9. A pull request with 100+ changed files: navigation time and browser memory.
