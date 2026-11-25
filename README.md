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

## Deploy the frontend with Docker

```sh
docker build -t paideuo .
docker run --rm -p 8080:80 -e POCKETBASE_URL=https://pocketbase.example.com paideuo
```

Open `http://localhost:8080`. Set `POCKETBASE_URL` to the origin of your
existing PocketBase instance, with no trailing slash. Use a hostname and port
reachable from inside the frontend container. Nginx serves the frontend and
forwards `/api/` requests to that instance.

The Docker image deploys the frontend and Nginx. For releases that change
PocketBase hooks, also update the active hooks directory on the PocketBase host
and restart PocketBase before rolling out the frontend. Apply migration
[`1760000031_linked_session_templates.js`](backend/pb_migrations/1760000031_linked_session_templates.js)
before deploying the linked-template hooks. Instances managed through the
collections export can import the updated schema with deletion of missing
collections and fields disabled.

### Timezone data for PocketBase

If scheduling reports **Choose a valid IANA timezone.** for a name such as
`America/New_York`, check that `/usr/share/zoneinfo/America/New_York` exists
inside the PocketBase container. The scheduling hook uses PocketBase's timezone
lookup, so the timezone database must be available to the backend process.

If the database is missing, add `tzdata` to the PocketBase image build. For
an Alpine-based image, use `RUN apk add --no-cache tzdata`. For a Debian-based
image, use `RUN apt-get update && apt-get install -y --no-install-recommends tzdata`.
Rebuild and redeploy the PocketBase container, then retry the schedule preview.

## Add Paideuo to an existing PocketBase instance

For a first install of Paideuo, open **Settings → Import collections** in
PocketBase, choose **Load from JSON file**, and select
[paideuo-collections.json](backend/paideuo-collections.json). Click **Review**,
keep deletion of missing collections and fields disabled, then confirm the import.
Copy the entire contents of [backend/pb_hooks](backend/pb_hooks) into your
instance's active hooks directory and restart PocketBase. Create app accounts
in `paideuo_users` from the admin dashboard.

If you import the JSON, skip the initial migrations below. The JSON already
contains the final collection schema.

If an earlier collections export left out `paideuo_import_operations`, re-import
the current JSON with deletion of missing collections and fields disabled.
MCP program writes use this collection to store import receipts.

### Install using migrations

Back up the instance and stop its service before applying the migrations. On
the PocketBase host, merge the contents of [backend/pb_migrations](backend/pb_migrations)
and [backend/pb_hooks](backend/pb_hooks) into the instance's active migrations
and hooks directories. Keep existing files and include the hook helper modules
alongside the `.pb.js` files. If any filenames overlap, check them before copying.

On a first import, the initial migration creates collections with names such
as `programs` and `blocks` before the next migration renames them to
`paideuo_*`. Check the collection names and index names in the
[initial migration](backend/pb_migrations/1760000000_program_management.js)
for conflicts with existing schema before proceeding.

Run the migration as the PocketBase service user, using the same binary, data
directory, and configuration as the service. Substitute your instance's paths.

```sh
pocketbase migrate up \
  --dir=/path/to/pb_data \
  --migrationsDir=/path/to/pb_migrations \
  --hooksDir=/path/to/pb_hooks
```

Restart PocketBase to load the hooks. In the admin dashboard, verify that
`paideuo_users` exists and create a record there for each app user who needs
access.

## Configure Google Health

Enable the Google Health API in Google Cloud and create a Web application OAuth
client. Register the exact public Paideuo URL ending in `/settings` as an
authorized redirect URI, for example `https://app.example.com/settings`.
Configure the consent screen for these restricted scopes.

- `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
- `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`

Follow
[Google's setup and verification requirements](https://developers.google.com/health/setup)
for your audience.

Set these variables in the **PocketBase process environment** and restart PocketBase.

| Variable                               | Value                                                                                                                        |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `PAIDEUO_GOOGLE_HEALTH_ORIGIN`         | Public Paideuo origin, such as `https://app.example.com`, without a trailing slash. Use HTTPS outside localhost development. |
| `PAIDEUO_GOOGLE_HEALTH_CLIENT_ID`      | Google Web application OAuth client ID                                                                                       |
| `PAIDEUO_GOOGLE_HEALTH_CLIENT_SECRET`  | Google Web application OAuth client secret                                                                                   |
| `PAIDEUO_GOOGLE_HEALTH_ENCRYPTION_KEY` | Persistent 32-character secret generated with `openssl rand -base64 24`                                                      |

Keep the encryption key in your server's secret store and back it up separately
from the PocketBase database. Users need an active profile in the Google Health
app before they can connect in **Settings → Google Health**.

## OpenAI macro estimates

Apply migration
[`1760000035_openai_settings.js`](backend/pb_migrations/1760000035_openai_settings.js)
or import the updated collections export. Set `PAIDEUO_OPENAI_ENCRYPTION_KEY`
in the PocketBase process environment and restart PocketBase. Generate a
persistent 32-character secret with `openssl rand -base64 24` and back it up
separately from the database. For local development, ensure your terminal loads
the variable before running `pnpm run dev:backend`.

Each user can save their own API key and model in **Settings → OpenAI**.
Prediction requests use that key and send the food title, category, serving
description, serving size, serving unit, and any food description to OpenAI.

## Seed a test program

With PocketBase running, set `TEST_EMAIL` and `TEST_PASSWORD` for an existing
`paideuo_users` account in your shell or the root `.env` file. Then run:

```sh
pnpm run seed:program
```

The script seeds an active eight-week climbing program and an earlier completed
cycle with two training blocks. The earlier cycle has completed and skipped
sessions with varied durations, effort ratings, and notes. Daily check-ins cover
the earlier cycle and recent days, with varied sleep, soreness, readiness,
nutrition, and occasional gaps.

The active schedule defaults to the current week's Monday in the local
timezone. Set `SEED_START_DATE` to a Monday in `YYYY-MM-DD` format or
`SEED_TIMEZONE` to an IANA timezone to override the defaults for a new
schedule. Reruns reuse existing schedules and fill in missing history while
preserving existing check-ins and session outcomes. The script prints calendar
and program routes for both cycles.

The default PocketBase URL is `http://127.0.0.1:8090`. Set `POCKETBASE_URL` to
use another instance.

## Seed a test food bank

With PocketBase running, use the same `TEST_EMAIL`, `TEST_PASSWORD`, and optional
`POCKETBASE_URL` as the program seeder, then run:

```sh
pnpm run seed:food-bank
```

Open **Plan → Nutrition** to see sample dishes, ingredients, and drinks with
per-serving macro estimates and two recipe attachments. New samples use matching
categories from your settings and stay uncategorized when a match is unavailable.
Reruns preserve edits and archives and avoid duplicate records.

## Verify

```sh
pnpm run lint
pnpm run fmt:check
pnpm run typecheck
pnpm run build
```

Apply formatting with `pnpm run fmt`.
