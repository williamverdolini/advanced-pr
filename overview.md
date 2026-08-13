# Advanced PR Review

A **Guided Review** tab inside every Azure DevOps pull request, for the reviews that are too large to read in one sitting.

## Why this exists

Yes, big pull requests are a bad practice. Split the work, keep each change small and self-contained, and everyone's life gets easier. That advice is right.

It just keeps not happening. AI-assisted development on a large codebase tends to carry a change all the way through: the feature, the call sites it breaks, the tests, the fixtures, the tooling that had to follow, the docs that went stale. Cutting that apart into pull requests that are each autonomous *and* each internally consistent is sometimes possible, often expensive, and occasionally a fiction: three pull requests that only make sense once all three are merged aren't three reviews, they're one review wearing a disguise.

So the problem worth solving isn't "make the pull request smaller". It's that **a reviewer has a limited budget of attention, and it should be spent where it changes the outcome.** The domain logic and the tricky boundaries deserve that budget. The regenerated fixtures, the baseline update, the tooling bump and the documentation pass deserve a glance, not a read, and pretending otherwise is how the important part ends up getting the tired half of someone's afternoon.

This extension lets the author say, in the pull request itself, which blocks actually matter and in what order to read them, with a note explaining why, while everything else lands at the end, in one step, to be acknowledged rather than studied.

Focus on what actually counts.

## How it works

The author splits the pull request into **steps** (*Core*, *Tests*, *Public API*) and the reviewer works through one at a time. Every decision is recorded as a real pull request comment, so the classic Azure DevOps interface keeps showing the whole story.

## What you get

**A review split into steps.** The author writes the plan as a comment on the pull request; the tab turns it into a stepper. Files not listed in any step fall into a final `Everything else` step, so nothing is ever left out. Without a plan the pull request simply has that one step, with every file in it.

**Notes that explain the code.** Each step can carry an optional `Explain` block: why the change looks like this, where to start reading, what to watch out for. It appears above the file list, and opens in a larger view when it gets long.

**Comments inside the diff.** Threads are rendered where the discussion belongs, under the line they refer to, with reply, edit, like and resolve available on the spot. Markdown is rendered, with a live preview while you write. The comment icon in the margin opens and closes each thread; the file tree lists them under their file.

**A diff that reads like the native one.** Monaco-powered, unified by default with a side-by-side switch, following the light or dark theme of the host. Added and deleted files are shown as plain content rather than as a diff against nothing, and the tree marks each file as added, modified, deleted or renamed.

**Step approvals, and one deliberate sign-off.** Approving a step records it; approving the last one asks whether you want to approve the whole pull request, which is the only action that touches your Azure DevOps vote. Requesting changes on a step sets *Waiting for author*. A push that changes a step's files invalidates its approval, and only that one.

## What it does not do yet

- **Reject the entire pull request**: approvals and change requests only.
- **Build and policy checks**: read them in the native tabs.
- **Linked work items.**

## Requirements

Azure DevOps Services, and any account with access to the pull request. No configuration, no server, no sign-in beyond Azure DevOps itself.

## Data and privacy

There is **no backend**. The extension is a static page that calls the Azure DevOps REST API from your browser, **as you**: comments and votes are attributed to your real account, exactly as if you had used the classic interface.

Nothing is stored outside Azure DevOps: the state of a review is reconstructed from the pull request's own comments every time the tab is opened. The only per-user setting kept, which files you have marked as viewed, lives in Azure DevOps extension storage, scoped to you.

**Requested permissions:** read and write code and pull requests (`vso.code_write`), read and write pull request comment threads (`vso.threads_full`), and per-user extension settings (`vso.extension.data_write`).
