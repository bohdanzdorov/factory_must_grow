# Factory Must Grow

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

2. Copy `apps/backend/.env.example` to `apps/backend/.env`.

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

Run commands for the demo will be added as those parts are built.
