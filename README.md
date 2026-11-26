# Factory Must Grow

[![CI](https://github.com/bohdanzdorov/factory_must_grow/actions/workflows/ci.yml/badge.svg)](https://github.com/bohdanzdorov/factory_must_grow/actions/workflows/ci.yml)

Routes orders across a network of factories and stays correct when a machine fails: no double-booking, no lost jobs, and human approval for every routing decision.

> Work in progress. This is an independent personal project.

## Repository layout

| Path              | Purpose                                   |
| ----------------- | ----------------------------------------- |
| `apps/backend`    | Express API, routing and failure handling |
| `apps/frontend`   | React operator UI                         |
| `apps/simulator`  | Machine simulator                         |
| `packages/shared` | Zod schemas and types shared by the apps  |
| `docs`            | Design notes                              |

## Getting started

Requires Node.js 22.13+ and Docker Desktop.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `apps/backend/.env.example` to `apps/backend/.env`, and `apps/simulator/.env.example` to `apps/simulator/.env`. The two `INGEST_TOKEN` values must match: it is the shared secret machines send with their heartbeats and events.

3. Start PostgreSQL (exposed on `localhost:5433`), apply migrations and load the [seed data](docs/seed-data.md):

   ```bash
   npm run db:up
   npm run db:deploy
   npm run db:seed
   ```

   Seeding replaces all data, so run `npm run db:seed` again at any time to reset to the seed.

4. Start the API on `http://localhost:4000`:

   ```bash
   npm run dev
   ```

5. Check it at `http://localhost:4000/health`, or list the seeded sites at `http://localhost:4000/api/sites`.

6. In a second terminal, start the operator UI on `http://localhost:5173`:

   ```bash
   npm run dev:frontend
   ```

   The UI forwards `/api` requests to the API, so both must be running. All times shown are simulated (60× real time by default), so a proposal must be approved within about 2 real minutes.

7. To simulate a machine, start one simulator per machine, each in its own terminal, with a site and machine id from the [seed data](docs/seed-data.md):

   ```bash
   npm run sim -- --site HAM --machine HAM-MILL5-1
   ```

   It sends a heartbeat every second, carries out the commands it gets back, and reports job and failure events. It reads simulated time from the API, so it can be started before or after it. It reads `SIM_API_URL` and `INGEST_TOKEN` from `apps/simulator/.env`; `--api <url>` overrides the URL. Successful heartbeats are not logged by the API, so its log stays readable with many machines running.

   Machines start OFFLINE after seeding and come online with their first heartbeat, so routing only uses machines whose simulator is running.

## Running tests

With PostgreSQL running (`npm run db:up`):

```bash
npm test
```

Tests use a separate database, `factorymustgrow_test`, which they create and migrate automatically. Every table is emptied before each test, so your development data is never touched. To point tests at another database, set `TEST_DATABASE_URL`; its name must end in `_test`.

Use `npm run test:watch -w @factorymustgrow/backend` to rerun tests on every change. Test files live in `apps/backend/test/`. The simulator's tests (`apps/simulator/test/`) need no database; run them alone with `npm test -w @factorymustgrow/simulator`.

Run commands for the demo will be added as those parts are built.
