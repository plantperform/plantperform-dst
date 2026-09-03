# Agent context for the `new-engine` branch

Read this whenever `git branch --show-current` is `new-engine`. It replaces the
production expectations in the root `CLAUDE.md`, except for the sections named
below.

## What this branch is

`new-engine` is a **prototype**. Its purpose is to find out what the product
should do, quickly, by building it and looking at it on localhost.

It is never merged. Once a week a developer ports the valuable parts into
`master` and resets this branch onto the new `master`. That means:

- Exploratory code is fine here. Duplication, a hardcoded constant, a component
  that has grown too large — all acceptable if they answer the question faster.
- Nothing here is permanent. Do not spend effort on abstractions that only pay
  off over months.
- **But everything here is read by another developer and their agent.** Leaving
  a clear trail is the highest-value thing you do on this branch.

The user is not a developer. They are the domain expert on nitrogen-aware
rotation planning. Explain in terms of behaviour and agronomy, not in terms of
React or git.

## Still applies here, without exception

**The git commit protocol — `docs/collab/git-commit-protocol.md`.** Read it if
it is not already in context. It is not production ceremony; it is the single
thing that decides how much of this branch's work survives the weekly port:

- A coherent, scoped, conventionally-described commit gets **cherry-picked into
  `master` as-is**. Nothing is lost in translation.
- A sprawling, mixed-concern, vaguely-described commit gets **reimplemented from
  scratch**. The behaviour survives; the code does not, and details the user
  cared about can quietly disappear.

Committing often is part of this. Ten small commits across a day port far better
than one large commit at the end, because each can be judged on its own. Never
batch a day's exploration into a single commit.

The user will not enforce this and cannot check it — they are not a developer.
It is on you.

**Danish domain terms stay Danish**: `mark`, `markblok`, `jbnr`, `udvaskning`,
`udledning`, `driftsform`, `nøgletal`.

**Never commit secrets.** `backend/.env` is local only.

## Does not apply here

- Pull requests. Commit and push straight to `new-engine`.
- Production polish, exhaustive error handling, test coverage.
- Refactoring `master`'s existing code for its own sake.

## Never, on this branch

- **Never switch to `master` or any other branch.** If work seems to require it,
  stop and tell the user to ask a developer.
- **Never merge, rebase, or cherry-pick.** If git reports a conflict, stop
  immediately, change nothing, and tell the user to ask a developer. Do not
  attempt to resolve it — resolving a conflict means deciding which of two
  people's work is correct, and that decision is not ours to make here.
- **Never force-push**, and never `git reset --hard` without the user asking.
- **Never delete or rewrite commits** that are already pushed.

## Keep the port cheap

These four habits cost almost nothing while prototyping and save hours later.
Prefer them, but do not let them block progress — if one gets in the way, note
it in `HANDOFF.md` and move on.

1. **Put calculation and domain logic in `frontend/src/lib/` or in a backend
   service under `backend/src/app/services/`, not inline in a component.** Logic
   in the right place ports almost unchanged. Logic tangled into a 600-line
   component has to be reimplemented.

2. **Go through `frontend/src/api/`** for backend access — the SWR hooks in
   `hooks.ts`, mutations in `mutations.ts`, types in `types.ts`. Components
   should not call `fetch` directly.

3. **Flag anything that changes a shared contract**, and say so in `HANDOFF.md`:
   - a new npm or pixi dependency
   - a change to an API request or response shape
   - a database migration under `backend/database/migrations/`
   - a renamed or deleted file that already existed on `master`

   These are the changes that break the port. They are allowed — just never
   silent.

4. **Say when something is a shortcut.** A hardcoded year, a stubbed value, a
   number that is right for one test farm only. Write it in `HANDOFF.md` under
   "Known shortcuts". An integrator who ships a hardcoded 2027 into production
   because nobody said it was temporary is the failure mode this prevents.

## HANDOFF.md

`HANDOFF.md` at the repository root is this branch's most important file. It is
how the week's work reaches the developers.

Keep it updated **as you go**, not only when `/handoff` is run. When you finish
a feature the user is happy with, add its entry immediately, while the reasoning
is still available. `/handoff` should be a review of something already written,
not an attempt to reconstruct a week from a diff.

Every entry answers, in plain language:

- **What** the user can now do that they could not before.
- **Why** — the agronomic or business reason. This is the part no diff contains
  and the part the integrator most needs.
- **Where** the important logic lives.
- **Status** — solid, or rough and still being explored?
- **Shortcuts** — anything hardcoded, stubbed, or known-wrong.

The template is in `.claude/commands/handoff.md`.

## Verifying work

The user runs the app locally and judges it in the browser. That is the real
check on this branch.

Before saying a change is done, run at least:

```bash
cd frontend && npm run build
```

A build that does not compile is the one failure the user cannot diagnose alone.
Never report that a check passed unless it was actually run.
