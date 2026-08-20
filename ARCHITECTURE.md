# Architecture

How the source is organised, and where a change belongs. For what the extension
does and why, read [README.md](README.md); for the reasoning behind each design
decision, [docs/azdo-extension-feasibility-plan.md](docs/azdo-extension-feasibility-plan.md).

## The four layers

```
core/        pure logic. No React, no network, no browser globals.
  ↑
platform/    everything that talks to Azure DevOps or to the host page.
  ↑
components/  reusable UI. Knows nothing about the review workflow.
  ↑
app/         state and composition. The only layer allowed to know everything.
```

**Dependencies point up that list, never down.** The one rule that matters:
`core/` imports nothing from `platform/`, `components/` or `app/`, and never
imports React. It is what makes the interesting logic testable without a DOM, a
network or a host, and every test in [tests/](tests/) exercises `core/` alone.

`components/` may import from `core/` but not from `platform/`, with one
deliberate exception: they import *types* from `platform/azureDevOpsClient`
(`ChangedFile`, `ReviewThread`) rather than redeclaring them.

## What lives where

**`src/core/`** — pure functions, one concern each, all covered by a test suite
except `hash.ts` (asserted through `reviewPlan`'s tests, which depend on it).

| Module | Concern |
|---|---|
| `reviewPlan.ts` | Parses the plan comment into steps and their related files; computes `planHash` and per-step `fingerprint` |
| `ledger.ts` | Formats and parses review events; `reduceReviewEvents` rebuilds review state; sign-off eligibility |
| `inlineZones.ts` | Decides which threads get an inline zone in the diff, and where |
| `markdown.ts` | The Markdown subset used in comments: parse, plain-text projection, mention extraction |
| `mentionQuery.ts`, `mentionText.ts` | Typeahead query detection; conversion between stored `@<id>` tokens and display text |
| `fileTree.ts` | Flat paths to a folder tree; the file name of a path |
| `threadIndex.ts` | Threads grouped by file, ordered by line |
| `changeType.ts` | Azure DevOps change bitmask to `add`/`edit`/`delete`/`rename`, and which diff side to show |
| `viewedFiles.ts` | Reconciles viewed marks against blob revisions, so a new push clears the stale ones |
| `toggleSet.ts` | Immutable membership updates for the `ReadonlySet` values held in React state |
| `theme.ts` | Whether a host CSS colour is dark |
| `splitterWidth.ts` | The files pane's default width and limits; reads a stored width back |
| `hash.ts` | `stableHash`, the deterministic hash behind plan and step identity |

**`src/platform/`** — the only layer that performs I/O. These are the services:
plain modules with exported functions, not classes (see *No dependency
injection* below).

| Module | Concern |
|---|---|
| `azureDevOpsClient.ts` | Every REST call, and the projection of raw API shapes into `PullRequestWorkspace` |
| `extensionContext.ts` | SDK handshake: signed-in user, pull request context, hosted-or-not |
| `identityService.ts` | The host's identity picker, for mentions. Caches every identity it has seen |
| `viewedFilesStore.ts` | Per-user viewed marks, in the extension data service |
| `splitterWidthStore.ts` | The files pane's width, in the browser's local storage |
| `hostNavigation.ts` | Reads and writes the host's `path` query parameter |
| `hostTheme.ts` | Observes the host's light or dark theme |

**`src/components/`** — `DiffViewer` (Monaco, view zones, decorations),
`FileTree`, `Markdown`, `MarkdownCommentEditor`, `MentionTypeahead`, plus
`mentionContext.ts` (the React context carrying the mention resolver) and
`caretCoordinates.ts`.

**`src/app/`** — state and composition, one file per component or concern.
`App.tsx` owns the session and the one fetch it depends on; `ReviewWorkspace.tsx`
is the container that wires the review together, and everything it renders sits
beside it: `StepWizard`, `StepActions`, `PlanEditor`, `ExplainPanel`,
`DiffLayoutSwitch`, `InlineThreadCard`, `InlineComposer`, `SignOffDialog`, plus
`diffCommands.tsx` (the card header commands) and `planTemplate.ts`.

Each self-contained piece of behaviour is a hook, which is this project's answer
to "a service per concern":

| Hook | Owns |
|---|---|
| `useAsyncResource` | A load, its `loading`/`error`, and discarding a stale response |
| `usePendingAction` | A write, its pending flag and its error |
| `useReviewState` | The decisions read from the ledger, and the three writes that add to them |
| `useInlineDiff` | What the editor needs to show comments in the code: zones, glyphs, scroll target |
| `useViewedFiles` | The viewed marks, loaded and persisted |
| `useMentionDirectory` | Resolving a mention id to a name |
| `useHostPathSync` | The open file, to and from the host's `path` parameter |
| `useCollapsedThreads`, `useDiffSelection` | Two small pieces of diff UI state |

Reach for `useAsyncResource` and `usePendingAction` rather than writing the
`let active = true` dance or another `try`/`catch`/`finally` by hand. When the
container grows a new concern, give it a hook before giving it more `useState`.

**`src/main.tsx`** — bootstrap: awaits the SDK handshake, then renders.

## Where a change goes

- **A new rule about plans, steps, events or diff layout** → a function in
  `core/`, plus a test. If it needs React or `fetch`, it is in the wrong layer.
- **A new Azure DevOps call** → `platform/azureDevOpsClient.ts`, returning a
  shape declared in that file. Raw API types must not escape it.
- **Something the host page owns** (theme, URL, identities, storage) → its own
  `platform/host*.ts` or service module, never called from `components/`.
- **UI reusable across the app** → `components/`, driven by props only.
- **Wiring, state, orchestration** → `src/app/`.

## Where state lives

1. **Host context** — pull request id, repository, project. Pushed in by the SDK
   through the `subscribeToContext` callback that `main.tsx` passes to `App`.
2. **Server state** — `PullRequestWorkspace`, one immutable snapshot rebuilt by
   `loadPullRequestWorkspace`. Comment actions call `refreshThreads`, which
   re-reads only the threads and keeps `files` and the pull request metadata by
   reference, so the diff editor is not torn down after every reply.
3. **Review state** — never stored. `reduceReviewEvents` derives it on each load
   from the ledger comments, which is why the extension needs no database.
4. **UI state** — `useState` in `App.tsx`, and lost on reload by design, except
   the open file (kept in the host's `path` query parameter) and the viewed marks
   (kept in the extension data service).

## Constraints that explain the design

**It is an iframe inside Azure DevOps.** The page owns no address bar, so there
is no router: the selected step and file are `useState`, and the only thing
persisted to the URL goes through `hostNavigation.ts` into the host's own `path`
parameter — the same one the native Files tab uses, which is what makes the two
tabs keep each other's place.

**There is no backend.** Every write is a real pull request comment, so the
classic Azure DevOps UI keeps showing the whole story, and no credential is ever
stored. The ledger is append-only: state is corrected by appending a new event
(`step-reset`), never by editing or deleting an old one.

**No dependency injection.** React has none, and this project adds none. A
service is a module, its singleton state is module-level state (see the lazy
`servicePromise` in `identityService.ts`), and consuming it is an `import`. Tests
avoid mocking it altogether by keeping the logic worth testing in `core/`, where
it takes its input as arguments. `React.createContext` is used only for values
that are genuinely ambient — today just the mention resolver.

**React 16.14.** Hooks yes; `ReactDOM.render` rather than `createRoot`, no
concurrent features, and much of the React documentation online assumes 18+.

## Conventions

- **Comments explain why, never what.** A comment earns its place by recording a
  constraint, a rejected alternative or a non-obvious consequence. `DiffViewer`'s
  notes on Monaco's `suppressMouseDown` and key handling are the model.
- **Tests cover `core/`.** Not a gap in coverage but the point of the layering:
  the parts worth testing were made pure so they could be. Integration is
  verified by hand in a test organization — see README §7.
- **Immutability in state.** React compares by reference, so a `Set` or `Map` in
  state is replaced, never mutated. Use `core/toggleSet.ts` rather than copying a
  set by hand: it returns the original when nothing changed, which skips a render.
- **British-neutral English, no abbreviations** in identifiers and comments.
- Run `npm run lint && npm test && npm run build` before opening a pull request.
