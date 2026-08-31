# PlantPerform

PlantPerform is decision-support software for nitrogen-aware crop rotation
planning. This repository contains the application implementation:

- `frontend/`: React, Vite, and TypeScript web application.
- `backend/`: FastAPI service and optimization model.
- `backend/database/`: local PostGIS setup, migrations, and registry loader.

Deployment infrastructure and environment-specific configuration are
maintained separately.

## Run locally

### Prerequisites

- [Pixi](https://pixi.sh/)
- Node.js and npm
- Docker with Docker Compose

### Start the database and backend

Create the local backend environment file:

```bash
cp backend/.env.default backend/.env
```

Authentication requires two locally generated secrets in `backend/.env`:
`AUTH_JWT_SECRET` and `AUTH_REFRESH_PEPPER` should each be at least 32 random
characters. In local development, verification links are printed in the
backend console automatically. The AWS deployment supplies the production
email settings at runtime and sends through Amazon SES without SMTP
credentials. `PUBLIC_APP_URL` must point to the frontend that is being used and
is also used as the default CORS origin. Set `CORS_ORIGINS` only when the
frontend needs to allow additional origins.
The authentication secrets are intentionally placeholders in `.env.default`; real
secrets must never be committed.

Then install the environment, start PostGIS, apply migrations, and run the API:

```bash
cd backend
pixi install
pixi run db-up
pixi run db-migrate
pixi run dev
```

The API listens on `http://localhost:8000`; its health endpoint is
`http://localhost:8000/api/v0/healthz`.

While developing a migration, revert the latest revision before editing it:

```bash
pixi run db-revert
```

If a migration has been edited before it was reverted, reset the local
database instead. This removes the Docker volume, recreates PostGIS, waits for
it to become healthy, and applies all migrations from scratch:

```bash
pixi run db-reset
```

`db-reset` is destructive and removes all data in the local database volume.

### Start the frontend

In another terminal:

```bash
cd frontend
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. The development
server proxies `/api` requests to the backend on port 8000.

The backend setting `ROTATION_START_CALENDAR_YEAR` controls the calendar year
used for position 1 when calculating new rotations. The frontend has its own
corresponding Vite setting, `VITE_ROTATION_START_CALENDAR_YEAR`, in
`frontend/.env`; keep the two values equal when changing the rotation start
year.

## Registry data

Registry source data is not distributed with this repository. If you are
authorized to use the source datasets, place these files in
`backend/database/data/raw/`:

- `DataIMK2023_DataPlantPerform_n609506_gpkg.zip`
- `CVR2023_AnomymKey.xlsx`
- `Mark2023_AfgroedeAggEfterNless_n13Afgroeder_n609512marker.xlsx`

Load the registry after applying migrations:

```bash
cd backend
pixi run load-registry
```

The loader truncates and repopulates `registry_field`; do not run it against a
database whose registry contents must be preserved.

## Development checks

```bash
cd backend && pixi run lint
cd frontend && npm run lint && npm run build
```

Database migrations are managed with Alembic. Apply new migrations before
running application code that depends on them:

```bash
cd backend
pixi run db-migrate
```
