# PlantPerform frontend

The frontend is a React and TypeScript application built with Vite. Before
starting it for the first time, create its local environment configuration:

```bash
cp .env.default .env
```

Set `VITE_ROTATION_START_CALENDAR_YEAR` in `.env` to change the calendar year
shown for position 1 in the frontend's eight-year rotation.

To start the development server:

```bash
npm ci
npm run dev
```

The development server proxies `/api` to `http://localhost:8000`. Start the
backend first when working with live application data.

Run the frontend checks with:

```bash
npm run lint
npm run build
```
