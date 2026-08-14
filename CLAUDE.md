# CLAUDE.md

Azure DevOps web extension adding a **Guided Review** tab to pull requests.
React 16.14 + TypeScript + Vite, Monaco for the diff, `azure-devops-ui` for
controls. No backend, no database, no stored credential.

Read [ARCHITECTURE.md](ARCHITECTURE.md) before changing code: it holds the layer
map, where each kind of change belongs, and the domain vocabulary (plan, step,
fingerprint, ledger, workspace). [README.md](README.md) covers behaviour and the
publishing workflow.

## Invariants

- **`src/core/` is pure.** No React, no network, no browser globals, and no
  imports from `platform/`, `components/` or `app/`. Breaking this is the one
  change that will not be accepted.
- **Dependencies point one way:** `core/` ← `platform/` ← `components/` ← `app/`.
- **New domain logic goes in `core/` with a test.** If it cannot be tested
  without a DOM or a host, it is in the wrong layer.
- **All Azure DevOps REST calls live in `platform/azureDevOpsClient.ts`.** Raw
  API types must not escape that file.
- **The ledger is append-only.** Correct state by appending an event, never by
  editing or deleting a comment.
- **State is replaced, not mutated** — React compares by reference. For sets in
  state use `core/toggleSet.ts`.
- **Never add** a manifest scope, PAT storage, service-account credentials or any
  secret to the client bundle. Scope changes invalidate the extension
  certificate and require an administrator to reauthorize every installation.
- **Never use `dangerouslySetInnerHTML`.** Comment text is authored by other
  users; `components/Markdown.tsx` renders it as React elements on purpose.

## Commands

```powershell
npm run lint     # eslint, including react-hooks rules
npm test         # vitest, covers src/core/
npm run build    # tsc -b && vite build
npm run dev      # Vite on https://localhost:3000, loaded through the dev manifest
```

Run lint, test and build before proposing a change is finished. Tests cover
`core/` only, so a change to `app/`, `components/` or `platform/` is not
validated by a green suite — say so plainly rather than implying it is verified.
Anything touching comment anchors, votes or the extension context also needs a
manual round-trip in a test organization, which cannot be done from here.

## Style

- Comments explain **why**, never what: a constraint, a rejected alternative, a
  non-obvious consequence. Do not add JSDoc to self-evident functions.
- English, no abbreviations in identifiers.
- Match the surrounding code: named exports, `function` declarations for
  components, `readonly`/`Readonly*` on data that is not meant to be mutated.
