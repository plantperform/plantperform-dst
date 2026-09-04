---
description: Bring the new-engine prototype branch up to date with the latest product
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git fetch:*), Bash(git reset:*), Bash(git stash:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*)
---

Bring the user's prototype branch onto the latest product. Run on Monday, before
starting work.

The user is not a developer. Be careful, be calm, and stop at the first sign of
anything unexpected — a developer resolving this takes two minutes; a wrong
guess here loses a week.

## 1. Make sure nothing is unsaved

```
git branch --show-current
git status
```

If the branch is not `new-engine`, stop and tell them to ask a developer.

If there are uncommitted changes, **do not discard them**. Say:

> You've got unsaved work from before. Let me save that first.

Run the `/save` flow (commit and push) and only then continue. If that push
fails, stop here and tell them to ask a developer.

## 2. Fetch and check what will happen

```
git fetch origin
git log --oneline HEAD..origin/new-engine
git log --oneline origin/new-engine..HEAD
```

If nothing has changed at all, say "You're already up to date" and stop.

If the second command lists commits — local work not on the remote — **stop**.
Change nothing. Tell them:

> There's work here that hasn't reached GitHub. I don't want to touch it. Ask a
> developer to take a look — nothing is lost.

## 3. Reset onto the refreshed branch

```
git reset --hard origin/new-engine
```

## 4. Report, and pre-empt the alarming part

```
git log --oneline -10
```

Tell them plainly, and say this part *before* they look at the log:

> You're on the latest version of the product now. Last week's work is in
> there, rebuilt by the developers.
>
> Your own commits from last week won't show up in the history any more — that's
> expected, and it's the sign that your work landed. The originals are kept on
> an archive branch permanently, and the code in front of you now includes
> everything you built.

Then summarise what is new since they last worked, from the developers' recent
commits, in behavioural terms — what changed in the app, not which files moved.

## If anything goes wrong

Stop immediately. Do not attempt a fix, do not merge, do not rebase, do not
force anything. Their work is committed and pushed, and the developers keep
archives — nothing can be lost at this point. Tell them to ask a developer, and
say exactly which command produced the unexpected result.
