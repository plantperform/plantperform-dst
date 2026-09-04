# Collaboration model: master and new-engine

Two people work in this repository in two different ways.

- **Developers** branch off `master`, open a pull request, merge back. Ordinary.
- **The prototyper** works on `new-engine`, exploring with an agent on
  localhost. That branch is a **prototype**, not a queue of work to merge.

## The rule that makes this work

> `new-engine` is never merged. Its commits are never rewritten. Once a week an
> integrator ports the valuable parts into `master` and resets `new-engine` onto
> the new `master`.

Everything else follows from that sentence.

### Why not merge it?

We tried, in PR #1. The merge itself was fine. The expensive part was
manufacturing `new-engine-clean` — rewriting thirty exploratory commits into
presentable ones so the history would be acceptable on `master`. That step is
manual, judgement-heavy, and cannot be repeated weekly. It also stranded the
original branch: the same content now existed on `master` under different SHAs.

So: **either take a commit as-is, or reimplement the behaviour. Never rewrite
someone else's history to make it mergeable.** Under this model his history is
discarded by the weekly reset, so it never needs to be presentable.

### Why does it not accumulate?

Because the reset happens every week. Divergence is bounded at roughly seven
days. Today that is 11 commits and 3 conflicting files — an afternoon. Left for
a month it becomes another PR #1.

**Cadence is the whole mechanism.** Skipping three weeks reintroduces the exact
problem this model exists to prevent.

## The team

Two developers working mainly on the frontend, one or two on the backend, and
the prototyper. Five people at most, so the process has to stay cheap.

| | Prototyper | Developers (4) |
|---|---|---|
| Branch | `new-engine` only | `master` + feature branches |
| Git knowledge needed | three slash commands | all of it |
| Resolves conflicts | never | always |
| Owns | *what* should exist | *how* it exists in `master` |

### One integrator, not a committee

**One developer holds the integrator role for a month at a time**, then hands it
on. Not per-week rotation — with four developers that means each does it once a
month and never builds fluency with the prototype branch. A month is long enough
to remember what was ported last time and what was deliberately dropped.

Do **not** split the port by layer, with a frontend developer taking the UI half
and a backend developer the schema half. Last week's dataset migration is the
reason: `b189c42` changed `registry_field`'s schema, added a table and an
endpoint, *and* changed what the field list displays — and the thing that had to
survive the port was a single invariant spanning all three (the UI shows the
same `jbnr` the engine computes with). Split across two people, that invariant
is exactly what falls through the gap.

The integrator owns the port end to end. Where a port lands in someone else's
territory, they **review** it:

- Backend changes — schema, migrations, services — reviewed by a backend
  developer before merge.
- Substantial frontend changes reviewed by the other frontend developer.

Review, not co-ownership. One person holds the intent.

### Prototype migrations are never ported as-is

The prototyper changes the database by reloading it. `master` cannot. Any
schema change in a handoff is written as a proper Alembic migration **by a
backend developer**, using the prototype's schema as the specification. The
integrator does not hand this to an agent unsupervised, and does not cherry-pick
it.

This is the single highest-risk category in the whole flow. Everything else is
recoverable by editing code.

### Tell the prototyper what is coming

With four developers on `master`, the real risk is not merge conflicts — this
model has no merges. It is **duplicated effort**: the prototyper spending a week
on something a developer is already rebuilding properly.

So the weekly reply back to him includes a line on what the team is building
next, and the prototyper steers around it. Cheap to say, expensive to skip.

## The weekly cycle

```
Mon–Thu   Prototyper explores on localhost. /save whenever.
Fri       Prototyper runs /handoff → HANDOFF.md describing the week's work.
Fri/Mon   Integrator reads HANDOFF.md, ports feature by feature into master,
          each as its own PR, agent-driven, following master's conventions.
Mon       Integrator archives and resets new-engine onto master.
          Prototyper runs /refresh and continues on fresh ground.
```

A full worked cycle against real commits from this repository:
[`example-week.md`](example-week.md). Read that first — it is the fastest way to
see what each role actually does.

Checklists: [`prototyper-weekly.md`](prototyper-weekly.md) ·
[`integrator-weekly.md`](integrator-weekly.md)

Agent context for the prototype branch:
[`prototyper-CLAUDE.md`](prototyper-CLAUDE.md)

## HANDOFF.md is the deliverable, not the diff

An agent asked to port 2000 lines of unfamiliar code will produce plausible
garbage. It needs to know *what each change was for* and *which parts were
deliberate versus incidental*. Only the prototyper's own agent has that — it was
in the room.

So the prototyper's real output each week is not the branch. It is `HANDOFF.md`:
a written statement of intent per feature. The code is the reference
implementation that goes with it.

If `HANDOFF.md` is thin, the port will be bad. This is the one piece of the
process that cannot be skipped.

## What the prototyper is never asked to do

Branch, merge, rebase, resolve a conflict, open a pull request, review code,
or decide whether something is production-ready. Every one of those requires
knowing which of two versions is correct — precisely the knowledge the role does
not have. No amount of git training fixes that; keeping it off their desk does.

## Guardrails to put in place

- Protect `master` on GitHub: no direct pushes, PR required.
- Protect `new-engine` against deletion, but allow force-push (the reset needs
  it) — the archive branch created before each reset is the safety net.
- CI on every push: `npm run build`, `npm run lint`, `ruff check`. The
  prototyper needs a green/red signal they can read without asking a developer.
- Preview deploys per branch, so the prototyper can see their work running
  without an integrator in the loop.
