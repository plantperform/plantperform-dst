# Weekly routine — prototyper (`new-engine`)

You need three commands. Nothing else. If anything asks you to do more than
this, that is a signal to ask a developer, not to learn more git.

| Command | When | What it does |
|---|---|---|
| `/save` | any time you have something worth keeping | commits and pushes your work |
| `/handoff` | Friday, before you stop | writes up the week for the developers |
| `/refresh` | Monday, before you start | brings your branch up to date |

---

## Every day

Work as you normally do. Ask Claude for what you want, look at it on
`http://localhost:5173`, iterate.

Run **`/save`** whenever something works, or when you are about to stop for a
while. There is no cost to saving often — every save is a point you can be
returned to. Nothing is truly safe until it is saved.

You do not need to save before switching tasks, and you do not need to think
about branches. You are always on `new-engine` and you always stay there.

### When something is worth remembering

When you finish something you are pleased with, say to Claude:

> Add this to HANDOFF.md.

It takes a moment and it is the single most useful thing you do for the
developers. Waiting until Friday means the reasoning has to be reconstructed
from code, and details get lost — especially *why* you built it that way.

---

## Friday, before you stop

1. Run **`/save`** so nothing is left behind.

2. Run **`/handoff`**.

   Claude will draft the week's write-up and show it to you. **Read it.** It is
   describing your work to people who were not there. Correct anything that is
   wrong or missing — particularly:

   - the *reason* a feature exists (Claude tends to describe what the code does,
     not why you wanted it)
   - anything you know is temporary, hardcoded, or only right for the test farm
   - anything you are unsure about or want a developer's opinion on

3. That's it. The developers take it from there.

### What happens next

A developer reads your write-up and moves the good parts into the real product
during the following week. They may rebuild something differently — that is
normal and does not mean it was wrong. Their version has to handle other farms,
other users, and cases you did not test.

If they have questions, they will ask you. Answer in terms of agronomy and
behaviour, not code.

---

## Monday, before you start

Run **`/refresh`**.

Your branch is reset onto the latest real product, which now contains last
week's work in its finished form. You continue from there.

### This part can feel wrong — it isn't

After a refresh, `git log` will not show your commits from last week. It looks
like your work was deleted. **It wasn't.**

- Your work is *in the product*, under the developers' commits.
- Your original commits are kept on an archive branch
  (`archive/new-engine-<date>`), permanently, in case anyone needs them.
- The code you see on Monday is your work, plus the developers' work, plus the
  rough edges smoothed off.

A refresh that removes your commits is the sign the system is working. It means
last week's work landed.

### If `/refresh` reports a problem

Stop and tell a developer. Do not try to fix it, and do not let Claude try to
fix it. Nothing is lost — it is saved and archived. This is a two-minute
conversation for a developer and a bad afternoon for anyone else.

---

## Things to hand to a developer, always

- Any message containing the word **conflict**.
- Anything asking you to choose between two versions of a file.
- Anything about `master`, merging, rebasing, or pull requests.
- Claude proposing to run `git push --force`, `git reset --hard`, or
  `git rebase` on its own initiative.

None of these are your job, and none of them are emergencies.
