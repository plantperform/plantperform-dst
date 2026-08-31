---
description: Write up this week's prototype work in HANDOFF.md for the developers
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git fetch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*), Read, Write, Edit
---

Write `HANDOFF.md` — the week's statement of intent for the developers who will
port this work into the product.

This document matters more than the code. An agent porting an unfamiliar diff
without knowing *why* each change exists will produce plausible, wrong results.
You were in the room; the porting agent was not.

## 1. Gather

```
git branch --show-current
git fetch origin
git log --oneline origin/master..HEAD
git diff --stat origin/master...HEAD
```

If the branch is not `new-engine`, stop and tell the user to ask a developer.

Read the existing `HANDOFF.md` if there is one. Entries for work already ported
(anything no longer in `git log origin/master..HEAD`) should be removed — the
file describes what is *pending*, not a permanent history.

Draw on our actual conversations this week, not only the diff. The reasoning
behind a change is in the conversation; the diff only shows the outcome.

## 2. Write

Write `HANDOFF.md` at the repository root. One section per feature, most
important first.

```markdown
# Handoff — week of <date>

## <Feature name in plain language>

**What it does.** What the user can now do that they couldn't before. Behaviour,
not implementation.

**Why.** The agronomic or business reason. Which decision it supports, which
question it answers. *This is the part no diff contains and the part the
integrator most needs — do not skip it or reduce it to one clause.*

**Where.** The files or functions carrying the important logic, and anything
subtle about how it works.

**Status.** Solid and behaving correctly / rough, still exploring / known broken
in these cases.

**Shortcuts.** Anything hardcoded, stubbed, or right for the test farm only.
Say so explicitly — an integrator who ships a hardcoded year into production
because nobody flagged it is the failure this section prevents.

**Contract changes.** New dependency, changed API shape, database migration,
renamed or deleted existing file. Anything here needs a developer's attention.

**Open questions.** Anything you want a developer's judgement on.

## <Next feature>
...

---

## Not worth keeping

Things tried this week that answered their question and can be discarded. Saying
so saves the integrator from puzzling over them.
```

Be concrete. "Improved the fertiliser display" is useless; "the ton gødning
figure now uses the amount actually applied rather than the norm-limited
utilisation, because advisers compare against what physically leaves the barn"
is what makes a good port possible.

Preserve Danish domain terms exactly: `mark`, `markblok`, `jbnr`, `udvaskning`,
`udledning`, `driftsform`, `nøgletal`.

## 3. Review it with the user

Show them the draft and say:

> Have a read — this is what the developers will work from. Two things worth
> checking: have I got the *reasons* right, and is there anything temporary or
> hardcoded I've missed?

Their corrections to the "Why" and "Shortcuts" sections are the highest-value
edits in this whole process. Wait for their response and apply it.

## 4. Save

Commit as `docs: handoff for week of <date>` and push to `new-engine`.

Then tell them:

> Sent. A developer will read this and move the good parts into the product this
> week. On Monday, run `/refresh` before you start.
