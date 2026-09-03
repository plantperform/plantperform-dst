# PlantPerform — agent context

Decision-support software for nitrogen-aware crop rotation planning.
See `README.md` for how to run the stack locally.

## Branch model

This repository has two kinds of branches, and they are worked on differently.

- `master` and feature branches off it — production code. Reviewed, merged via
  pull request.
- `new-engine` — a **prototype branch**. It is explored freely, it is never
  merged, and it is reset onto `master` after each integration round.

**If the current branch is `new-engine` (check with `git branch --show-current`),
also read and follow `docs/collab/prototyper-CLAUDE.md` before doing anything
else.** The rules there replace the production expectations below.

The full collaboration model is in `docs/collab/README.md`.

## Stack

Frontend (`frontend/`): React 19, TypeScript, Vite, React Router, SWR for data
fetching, Tailwind 4, Radix primitives with `class-variance-authority`, MapLibre
via `react-map-gl`.

- `src/api/` — client, SWR hooks, mutations, and generated-ish API types.
  All backend access goes through here; components never call `fetch` directly.
- `src/lib/` — pure domain and presentation logic (field domain, geo helpers,
  map colouring, label tables). Calculation and mapping logic belongs here,
  not inline in components.
- `src/components/farm/` — feature components. `src/components/ui/` — primitives.
- `src/pages/` — route-level components.

Backend (`backend/`): FastAPI, Pixi-managed environment, Ruff, PostGIS with
Alembic migrations under `backend/database/migrations/`. Domain services live in
`backend/src/app/services/` (`economics`, `nles5`, `optimization`, `rotations`,
`scenario`, `soil`).

## Language

Code, comments, and commit messages are in English. Danish domain terms and UI
labels are preserved verbatim — `mark`, `markblok`, `jbnr`, `udvaskning`,
`udledning`, `driftsform`, `nøgletal` — because translating them loses
precision. Do not anglicise them.

## Checks

Before claiming work is done:

```bash
cd frontend && npm run build      # tsc -b && vite build
cd frontend && npm run lint
cd backend && pixi run ruff check .
```

Never claim a check passed unless it was actually run.

## Git commit protocol

@docs/collab/git-commit-protocol.md

This applies on every branch, including `new-engine`. On the prototype branch it
is what decides whether a commit is cherry-picked into `master` as-is or has to
be reimplemented.

## Never

- Commit or push directly to `master`. Work goes through a pull request.
- Force-push a shared branch, except the documented `new-engine` reset in
  `docs/collab/integrator-weekly.md`.
- Commit secrets. `backend/.env` is local only; `.env.default` holds
  placeholders.
