# Weekly routine — integrator (`master`)

Budget roughly half a day per week. That is the price of the model, and it is
paid continuously or it is paid all at once later, with interest — see PR #1.

You hold this role for a month, then hand it on. You are the only person who
touches both branches, and the only one holding the intent of a port end to end
— see `README.md` for why the role is not split by layer.

Your colleagues **review**; they do not co-own. Two gates are mandatory:

- **Any schema change or migration is written by a backend developer**, not by
  you and not by an agent. The prototyper changes the database by reloading it;
  `master` needs a real Alembic migration. This is the highest-risk category in
  the flow — everything else is recoverable by editing code.
- **Substantial frontend ports are reviewed by the other frontend developer**
  before merge.

---

## 1. Assess (10 minutes)

```bash
git fetch --all --prune

git rev-list --left-right --count origin/master...origin/new-engine
git log --oneline origin/master..origin/new-engine
git diff --stat origin/master...origin/new-engine | tail -1

# conflicts, without touching the working tree
git merge-tree --write-tree --name-only origin/master origin/new-engine \
  | grep -i conflict
```

Read `HANDOFF.md` on `origin/new-engine` — that is the actual input:

```bash
git show origin/new-engine:HANDOFF.md
```

**Health check.** Under ten commits and a handful of conflicting files is
normal. Thirty-plus commits, or conflicts in files you rewrote, means a week was
skipped. Do not respond by skipping another one; do a bigger port now.

---

## 2. Triage (15 minutes)

Go through `HANDOFF.md` feature by feature and put each into one of three
buckets. Write the result down — it becomes the note you send back.

**Cherry-pick.** The commit is coherent, scoped, already conventional, and
touches code you are happy with. Take it as-is. Cheapest path by far, and the
prototyper's commit protocol is specifically there to make this bucket large.

**Reimplement.** The behaviour is right but the code is not — logic tangled into
a component, a shortcut that has to become general, a shape that will not
survive other farms. Use the diff as a specification, not as source.

**Drop.** Exploration that answered its question. Say so explicitly in your
reply; silence reads as "lost".

### Deciding between cherry-pick and reimplement

Cherry-pick when the commit is small, self-contained, and you would have written
something close to it. Reimplement when it is large, crosses layers, or contains
a shortcut flagged in `HANDOFF.md`.

When genuinely torn, reimplement. A bad cherry-pick puts prototype-quality code
in `master` permanently; a redundant reimplementation costs an hour.

**Never rewrite his commits into tidier ones to make them mergeable.** That is
the PR #1 trap: manual, unrepeatable, and it strands the source branch. Take a
commit as it is, or do not take it.

---

## 3. Port

One branch and one pull request per feature. Never one giant PR — that is how
PR #1 became unreviewable.

### Cherry-pick path

```bash
git switch -c port/<feature> origin/master
git cherry-pick <sha>...
```

If a cherry-pick conflicts badly, stop and move that feature to the reimplement
bucket. Do not fight it.

### Reimplement path (agent-driven)

**First, carve out any migration.** If the feature changes the database schema,
hand that part to a backend developer now and let the agent port the rest
against the schema they define. Do not let an agent invent a migration from a
prototype that never had one.

Give the agent the intent, the reference implementation, and the conventions.
The prompt below is the standard form — adapt the bracketed parts.

> Port the feature "[name]" from `origin/new-engine` into `master`.
>
> **Intent** (from `HANDOFF.md`, the authoritative statement of what this is
> for):
>
> > [paste the HANDOFF.md entry verbatim]
>
> **Reference implementation** — this is a prototype. Treat it as a
> specification of behaviour, not as code to copy:
>
> ```
> git diff origin/master...origin/new-engine -- [paths]
> git log -p origin/master..origin/new-engine -- [paths]
> ```
>
> **Rules**
>
> - Follow the conventions in the root `CLAUDE.md` and match the surrounding
>   code in `master`.
> - Domain and calculation logic belongs in `frontend/src/lib/` or in a service
>   under `backend/src/app/services/` — not inline in a component. If the
>   prototype has it inline, move it.
> - Backend access goes through `frontend/src/api/`.
> - Preserve Danish domain terms and UI labels exactly.
> - These shortcuts from `HANDOFF.md` must be generalised, not carried over:
>   [list them, e.g. hardcoded start year 2027].
> - Do not import prototype code that this feature does not need.
> - Reproduce the prototype's *behaviour*. Where the prototype's structure
>   conflicts with `master`'s conventions, conventions win.
>
> **Before finishing**
>
> - `cd frontend && npm run build && npm run lint`
> - `cd backend && pixi run ruff check .`
> - Report any place where the prototype's intent was ambiguous rather than
>   guessing.
>
> Commit following the git protocol in `CLAUDE.md`.

### Review it yourself

The agent will produce something plausible. Plausible is not correct, and the
prototyper cannot catch the difference. Check in particular:

- shortcuts from `HANDOFF.md` actually generalised, not silently shipped
- API contract changes matched on both sides
- migrations ordered correctly against anything merged since
- no prototype-only helper dragged along unused

Run it against a real farm before merging.

---

## 4. Reset `new-engine` (5 minutes, Monday)

Only after the ports are merged to `master`.

```bash
git fetch --all --prune

# 1. Archive the prototype history, permanently. This is the safety net
#    that makes the force-push in step 3 reversible.
git branch archive/new-engine-$(date +%Y-%m-%d) origin/new-engine
git push origin archive/new-engine-$(date +%Y-%m-%d)

# 2. Confirm nothing unported is about to be discarded.
git log --oneline origin/master..origin/new-engine

# 3. Reset the prototype branch onto the new master.
git push origin origin/master:new-engine --force-with-lease
```

Step 2 is not optional. Read the list and confirm every commit on it is ported
or deliberately dropped. Once you are past this step, the only recovery is the
archive branch.

`--force-with-lease` fails if the prototyper pushed while you were working. If
it does, fetch and redo steps 1–2; do not reach for `--force`.

---

## 5. Reply (5 minutes)

Send the triage list back, in plain language:

- **Shipped** — what is now in the product.
- **Rebuilt differently** — what changed and why, in behavioural terms.
- **Not taken** — and the reason. Never leave this silent.
- **Questions** — anything ambiguous in `HANDOFF.md`.
- **What we're building next** — one or two lines on what the four developers
  are picking up this week, so he does not spend a week prototyping something
  already being built properly. With four people on `master` this is the main
  way effort gets wasted, and it costs a sentence to prevent.

Then tell them to run `/refresh`.

This step looks like overhead and is not. It is the only feedback the prototyper
gets that their week mattered, and it is what teaches them which kinds of
write-ups produce good ports.

---

## Recovering a mistake

Everything is on `archive/new-engine-<date>`:

```bash
git log --oneline archive/new-engine-<date>
git cherry-pick <sha>
```

Never delete archive branches. They are small and they are the reason the reset
is safe.
