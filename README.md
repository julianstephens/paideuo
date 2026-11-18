# Climbing Training Planner

A calendar-first climbing training planner with an authenticated Programs workspace. See [plan.md](plan.md) for the product specification.

Icon created by Ludovic Riffault from the Noun Project

## Prerequisites

- Node.js 24 and pnpm 11.25.0
- [PocketBase](https://pocketbase.io/docs/) 0.40.1 on your PATH. Check with `pocketbase --version`.

## Run locally

Install dependencies with `pnpm install --frozen-lockfile`. From the repository root, run these commands in two terminals:

```sh
pnpm run dev:backend
```

```sh
pnpm run dev
```

After signing in, Calendar reports whether PocketBase is reachable through the Vite proxy. If the connection fails, check that PocketBase is listening on `127.0.0.1:8090`, then select **Retry connection**.

PocketBase stores local data in `backend/pb_data`. The development launcher uses `backend/pb_migrations` and `backend/pb_hooks` for schema migrations and server logic. PocketBase applies the migrations on startup.

Open the [PocketBase dashboard](http://127.0.0.1:8090/_/) and follow the superuser setup instructions printed by PocketBase on first launch. In the dashboard, create a record with an email and password in the `paideuo_users` collection. Open [http://localhost:5173](http://localhost:5173) and sign in with that account.

For auth implementation and troubleshooting conventions, see
[PocketBase and React Development Notes](docs/pocketbase-auth-development.md).

## Seed a test program

With PocketBase running, set `TEST_EMAIL` and `TEST_PASSWORD` for an existing
`paideuo_users` account in your shell or the root `.env` file. Then run:

```sh
pnpm run seed:program
```

The script creates an eight-week climbing program with two blocks, 24 planned
sessions, and four searchable templates with default durations, intensities, and
structured targets. It saves a hybrid climbing, strength, and conditioning session
as a template and copies its defaults and targets into the second block. On
reruns, the script reuses matching records and upgrades older seed data that
still matches the original. It prints the program's route. The default PocketBase URL is
`http://127.0.0.1:8090`. Set `POCKETBASE_URL` to use another instance.

## Verify

```sh
pnpm run lint
pnpm run fmt:check
pnpm run typecheck
pnpm run build
```

Apply formatting with `pnpm run fmt`.
