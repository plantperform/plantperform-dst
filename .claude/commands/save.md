---
description: Save and push the current work on the new-engine prototype branch
allowed-tools: Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git branch:*), Bash(git add:*), Bash(git commit:*), Bash(git push:*)
---

Save the user's work. The user is not a developer — report in plain language,
never show them raw git output, and never ask them a git question.

## 1. Check the branch

```
git branch --show-current
```

If it is not `new-engine`, **stop**. Change nothing. Tell them:

> You're not on the prototype branch right now, so I haven't saved anything.
> Ask a developer to put you back on `new-engine` — it's a one-minute fix.

## 2. Look at what changed

```
git status
git diff
git diff --staged
git log -10 --oneline
```

If there is nothing to save, say so in one line and stop.

## 3. Commit

Group the changes by observable behaviour and make one commit per coherent
change, following the git commit protocol in `CLAUDE.md`. Several small commits
are better than one large one — they can be taken into the product as-is, which
saves the developers real work.

Write messages from the diff, not from our conversation.

Do not commit debugging output, commented-out code, or temporary files. If you
see any, mention it and leave it unstaged.

## 4. Push

```
git push origin new-engine
```

If the push is rejected, **stop**. Do not pull, merge, rebase, or force. Tell
them:

> Your work is saved on this computer but I couldn't send it to GitHub — someone
> else has changed the branch. Nothing is lost. Ask a developer to sort it out.

## 5. Report

One or two sentences: what was saved, in terms of behaviour. For example
"Saved: the two-level nøgletal dropdown, and the fix to the ton gødning
figure."

Then, if this finished a feature the user seemed happy with, ask:

> Want me to add this to HANDOFF.md while it's fresh?
