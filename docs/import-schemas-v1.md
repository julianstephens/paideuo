# Paideuo import schemas v1

Paideuo's bulk-ingestion contract is independent of PocketBase collection names and internal record
IDs. Import documents use the following envelope:

```json
{
  "schema": "paideuo",
  "version": 1,
  "kind": "program",
  "data": {}
}
```

The supported `kind` values are:

- `program` for a complete hierarchical training program.
- `session-templates` for reusable sessions in the Library.
- `workout-component-results` for date-scoped workout and component observations.
- `daily-check-ins` for date-scoped recovery and nutrition observations.
- `heart-rate-recording` for heart-rate recording provenance and sample metadata, not sample values.

The server normalizer is `backend/pb_hooks/import-schemas.js`. It rejects unknown fields at every
level, non-JSON object shapes, invalid enums, malformed dates, invalid nesting, duplicates, and
values outside the documented limits. It returns a new object without mutating the request.

## Identity and references

Program, block, week, slot, workout, and recording `externalId` values are caller-defined stable
keys. They are trimmed non-empty strings of at most 200 characters and are used to reconcile imported
objects without exposing PocketBase records. External IDs must be unique in their applicable
collection.

An optional `id` is a PocketBase record ID and means “update this existing record.” Every server
consumer must supply `authorizeReference(type, id)` to the normalizer and return a valid result only
when that record belongs to the authenticated user. Supplying a record ID without an authorization
callback, or supplying an unauthorized ID, is rejected. Missing `id` values normalize to `null`.
Nested prescription slot references use `slotExternalId`, which must resolve within the same block.
Daily observations use their civil `date` as their identity.

Import documents never perform writes themselves. A client must not treat validation success as a
commit, and consumers must reject direct collection field names or arbitrary PocketBase relation
writes.

## Omitted and null values

Required fields must be present. Optional text normalizes to an empty string, optional scalar values
normalize to `null`, and an omitted optional object normalizes to an object containing explicit
null/empty values. Callers may omit optional fields or send `null` when their type permits it; both
represent the same normalized meaning.

Arrays remain in their supplied semantic order. The exception is daily check-ins, which are sorted
by date after duplicate dates are rejected.

## Session templates

Choose **Import templates** in the Library or upload the JSON from Bulk imports. A document
contains up to 100 entries in `data.templates`. Each entry requires `externalId`, `name`, and
`sessionType`. It can also include `description`, `plannedDurationMin`, `plannedDurationMax`,
`plannedRpeMin`, `plannedRpeMax`, `plannedIntensity`, and `components`. These use the same
prescription ranges and component format as program imports. Keep component keys stable across
updates.

External IDs are unique within each owner's Library. A repeat import updates the matching template
if its content changed. To assign an external ID to a template you previously created by hand,
include its authorized template record `id` on the first import. Imported external IDs are shown
in the Library. A service credential needs `imports:commit` and `programs:write`.

See [the session templates sample](examples/import-v1-session-templates.json).

## Program hierarchy

A `program` import has:

- `data.program`: `externalId`, optional `id`, `name`, and optional `description`, `objective`, and
  `status`.
- `blocks`: up to 100 blocks with unique external IDs and one-based `position` values. `durationWeeks`
  is a whole number from 1 to 520.
- `slots`: up to 64 slots per block, with unique one-based positions, weekday from 1 (Monday) through
  7, and required external ID and label.
- `weeks`: exactly one entry for every week in the block duration. Week positions and external IDs
  are unique within the block.
- `prescriptions`: at most one per block slot for a given week.
- `workout`: the existing Paideuo workout prescription and component contract.

Program status is `draft`, `active`, `completed`, or `archived`. Workout session type, intensity,
component, target, duration, and RPE constraints match the existing program and workout editors.
Components are limited to 100 per workout. Component `key` values are unique within a
prescription and are used by later workout-result imports. Every component in an existing
prescription needs an explicit key. Use each retained component's current key when inserting,
removing, or reordering components. For a new prescription, an omitted key defaults to
`component-N`, where `N` is the one-based component position.

Aerobic plans use components with `classification: "aerobic"`. A component's `durationMin` is
its planned elapsed duration. If omitted, reporting uses the sum of its interval durations.

`targets.segments` is a nonempty array in workout order. Each entry has a `type` of `warmup`,
`work`, `recovery`, or `cooldown`, and a nonnegative whole `duration_seconds`. Set the optional
`modality` to `running` or `walking` to include the segment in the corresponding planned
breakdown. `targets.repetitions` is a nonnegative whole count for the work and recovery segments
and defaults to one. Warmup and cooldown occur once. When segments are omitted, `work_seconds`
and `rest_seconds` can specify an unlabelled work and recovery pair. The longest scheduled work
segment supplies the planned bout target.

A slot can include `templateExternalId` to copy an existing Library template into its baseline.
The template must belong to the importing owner. A missing template is a preview conflict.
Omit the field to preserve the slot's current baseline or set it to `null` to clear the baseline.
Future Library edits do not modify the saved baseline. Week prescriptions remain explicit in the
program document.

In Bulk imports, select workouts under **Save to Library**, then preview the selection before
confirming the import. Program JSON can also supply `data.templateWorkoutKeys`, an optional list
of up to 100 prescription keys as shown in preview. Paideuo saves each selected workout as a
template in the same transaction as the program and uses a stable import ID so repeat selections
reconcile with the previously saved template.

See [the program sample](examples/import-v1-program.json).

## Workout component results

The result data contains a stable `sourceWorkoutKey`, a valid completion `date` in `YYYY-MM-DD`
format, optional duration and session RPE, notes, and up to 100 components. Each component has a
unique `key` and unique one-based `plannedPosition`. The key, position, and name must match the
scheduled prescription snapshot; results cannot reference live program components.

`sourceSessionId`, when supplied, is an authorized `scheduled-session` reference. Actual durations,
sets, rounds, and positions are non-negative whole numbers (positions are at least one); RPE is
from 1 through 10. Load is an object containing a non-negative `value` and a non-empty `unit`.
At the workout level, `actualDurationMin` records training time used to calculate session load.
Log optional recovery time on its component result and exclude it from the workout duration.

For a component, `actualDurationMin` is elapsed time. `runningMin` and `walkingMin` are optional
parts of that time and their sum must fit within the elapsed duration when supplied.
`continuousBoutMin` is the longest uninterrupted effort. When running minutes are supplied, the
bout describes running and must fit within that time. Otherwise it must fit within the elapsed
duration, or the walking duration if that is the only available total. Each field uses
nonnegative whole minutes, with missing values stored as null.

Actual aerobic totals use elapsed minutes when available and otherwise sum the recorded running
and walking minutes. Coverage counts aerobic components with a measured duration out of all
aerobic components in completed sessions. The optional `aerobicModality` label groups actual
minutes by activity, such as cycling or run/walk.

Program imports derive prescription workout keys as
`<program>/<block>/<week>/<slot>` using the four external IDs, providing a unique owner-scoped
observation key. If that readable form would exceed the 200-character key limit, Paideuo substitutes
the stable `workout:<sha256>` form. Use the key shown for the prescription row in preview responses
as the source workout key for later observations.

See [the workout results sample](examples/import-v1-workout-results.json).

## Daily check-ins

Each document contains at most 366 entries. Dates are valid civil dates and must be unique.

Recovery fields reuse the check-in editor's ranges: sleep hours 0–24, quality/fatigue/soreness/
readiness whole values from 1–5, and resting heart rate as a positive whole BPM value. Nutrition
choices and protein constraints also match the editor.

See [the daily check-in sample](examples/import-v1-daily-check-ins.json).

## Heart-rate recording metadata

A recording contains a `sourceWorkoutKey`, RFC 3339 start/end timestamps, an IANA timezone, and
`units: "bpm"`. End must be later than start. Device and algorithm fields, provider, external ID,
sample interval, and sample count are optional. A supplied `sourceSessionId` requires
`scheduled-session` authorization.

The schema intentionally does not accept sample arrays or derived minimum/maximum/average values.
Those require a separate schema and persistence decision.

See [the heart-rate recording sample](examples/import-v1-heart-rate.json).

## Preview and commit API

Authenticated clients send any document above directly to:

```text
POST /api/paideuo/v1/imports/preview
```

Non-human writers can use owner-scoped service credentials instead of a user password. Send an
`Authorization` header with the issued service token:

```text
POST /api/paideuo/v1/imports/service/preview
```

and:

```text
POST /api/paideuo/v1/imports/service/commit
```

Service credentials are issued and revoked by authenticated owners at:

```text
GET  /api/paideuo/v1/service-credentials
POST /api/paideuo/v1/service-credentials/issue
POST /api/paideuo/v1/service-credentials/{id}/revoke
```

Plaintext tokens are returned only once at issuance time. Stored credentials are hash-only, owner
bound, revocable, and may include an expiry timestamp plus explicit scopes:
`imports:commit`, `programs:read`, `programs:write`, `workouts:read`, `workouts:write`,
`metrics:read`, `metrics:write`, `recordings:write`.

The server validates and normalizes the complete document, checks every supplied PocketBase ID
against the authenticated owner, and compares it with current state. Preview responses contain an
opaque `previewToken` and one `items` entry per logical row:

```json
{
  "previewToken": "opaque",
  "schema": "paideuo",
  "version": 1,
  "kind": "program",
  "items": [
    {
      "type": "program",
      "key": "foundation-program",
      "id": null,
      "status": "create"
    }
  ],
  "conflicting": 0
}
```

Status is `create`, `update`, `skip`, or `conflict`. Preview does not write any collection, preview
receipt, session, or component.

Commit re-submits the exact normalized preview inputs:

```json
{
  "previewToken": "opaque",
  "document": {
    "schema": "paideuo",
    "version": 1,
    "kind": "program",
    "data": {}
  }
}
```

The commit is accepted only when the issued token, owner, document, and current referenced state
still match. Changed, consumed, expired, stale, or tampered previews return `409`. Tokens are held
opaquely in server memory for 15 minutes and are consumed on commit; a server restart therefore
invalidates outstanding previews.

Program hierarchies are applied in one database transaction. Constraint or persistence failures
roll the entire hierarchy back, including blocks, weeks, slots, prescriptions, and components.
Scheduled session rows are never changed by an import commit. When a program already has a schedule,
the commit returns `scheduleSynchronization: "review-required"` and clients must use the existing
schedule revision preview/apply workflow.

Daily check-ins are batch observations and return a status for every date. Workout results and
heart-rate recordings return a status for their single source workout. Observation commits are
atomic at present; Paideuo does not expose partial-best-effort observation mode. A future partial
mode must be explicitly requested and must return a per-row `committed`, `skipped`, or `failed`
status without allowing failures to make committed rows ambiguous.

Historical completed-workout replacement remains blocked unless the import request explicitly asks
for replacement and the service credential was issued with destructive-history authorization.

## Stable domain HTTP endpoints

The domain endpoints use the same v1 validation, authorization, and transactional ingestion
service as preview and commit. Send the domain payload directly or in a `data` object.

- `POST /api/paideuo/v1/programs` creates or reconciles a program from `program` and `blocks`.
  Supply complete v1 values for each submitted program, block, slot, week, and prescription.
  Omitted optional fields on submitted records take their schema defaults. An omitted program
  status retains the current status on update and defaults to draft on creation. Records outside
  the submitted hierarchy are retained. The response counts the program as one row and supplies
  `programId` and `scheduleSynchronization` on that row. Changes anywhere in an existing hierarchy
  count as a program update.
- `POST /api/paideuo/v1/workouts/results/batch` accepts `{ "results": [...] }`.
  Each result is a complete completion and component list. Replacement requires
  `replaceExistingCompletion: true` and a service credential with destructive-history authorization.
  A batch cannot repeat a source workout key or resolve multiple results to the same session.
- `POST /api/paideuo/v1/check-ins/upsert` accepts `{ "entries": [...] }`. Each date may appear once.
  Omitted fields and groups retain their stored values. Explicit `null` clears a field to its v1
  default (null for optional measurements and empty text for notes). A null group clears all
  fields in that group.
- `POST /api/paideuo/v1/heart-rate/recordings/attach` accepts one complete recording. Omitted
  optional fields take their schema defaults. The recording is identified by its external ID
  when supplied, with the existing source workout key fallback for recordings without one.

For service credentials, use the corresponding `/api/paideuo/v1/service/...` routes. Human routes
require an authenticated user. Service routes require `imports:commit` plus the corresponding
`programs:write`, `workouts:write`, `metrics:write`, or `recordings:write` scope.

Supply a top-level `operationId` to make retries replay the original successful response. IDs are
shared across ingestion endpoints for each owner. Reusing an ID for different content or another
endpoint domain returns `409`. Object property order is ignored, while array order and the
difference between omission and explicit null are significant. Send the same payload and ID on
retry. The server generates an ID when omitted. Successful batches persist the payload hash,
original response, provenance, and audit summary in the same transaction as the writes. Top-level
provenance fields have the same meaning as on the generic commit endpoint.

## MCP tools

### Connect ChatGPT

## v0.2.0

Deploy the frontend and PocketBase hooks together and apply the PocketBase migrations. Set these
environment variables on the **PocketBase process**:

| Variable                          | Value                                                                                                                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PAIDEUO_MCP_OAUTH_ORIGIN`        | The public HTTPS origin that serves the Paideuo frontend and proxies PocketBase, such as `https://paideuo.example.com`. Omit the trailing slash.                                                     |
| `PAIDEUO_MCP_OAUTH_CLIENT_ID`     | A client ID you choose, such as `paideuo-chatgpt`.                                                                                                                                                   |
| `PAIDEUO_MCP_OAUTH_CLIENT_SECRET` | A random server-side secret, such as the output of `openssl rand -hex 32`. Use 32–256 URL-safe characters.                                                                                           |
| `PAIDEUO_MCP_OAUTH_REDIRECT_URI`  | Optional exact ChatGPT callback URI. Defaults to `https://chatgpt.com/connector_platform_oauth_redirect`. Set it if ChatGPT shows a different callback under `https://chatgpt.com/connector/oauth/`. |

After restarting PocketBase, check that the public URL
`/.well-known/oauth-protected-resource/api/paideuo/v1/mcp` returns JSON and lists the same origin
that appears as the issuer at `/.well-known/oauth-authorization-server`. The bundled nginx
configuration forwards both URLs. If you run your own proxy, forward them to PocketBase along
with `/api/`.

In ChatGPT, open **Plugins → Add custom MCP server**. Enter **Paideuo** and use
`https://<your-paideuo-host>/api/paideuo/v1/mcp` as the **Server URL**. Choose **OAuth**, then use the
predefined client option in **Advanced OAuth settings**. Enter the configured client ID and secret
and set the default scope to `paideuo:mcp`. Both `client_secret_basic` and `client_secret_post`
are supported. Create and install the plugin, sign in to Paideuo when prompted, and approve
access. In a conversation with the plugin enabled, ask it to list your Paideuo training programs.
See [OpenAI's custom MCP server guide](https://developers.openai.com/api/docs/guides/custom-mcp-server).

If `/authorize` returns HTTP 400, check the response's `error_description`. The predefined
client ID must match the PocketBase environment, the redirect URI must match the callback shown
in ChatGPT, and the Server URL must exactly match the metadata's `resource` value, including the
path and its lack of a trailing slash. ChatGPT starts the flow with an S256 PKCE challenge, so
opening the authorize endpoint directly without the OAuth parameters also returns HTTP 400.

If consent fails after signing in, verify that `paideuo_mcp_oauth_grants` exists in the
PocketBase instance serving Paideuo. Migration `1760000029_mcp_oauth_grants.js` creates the
collection needed to issue an authorization code. Deploying the hooks alone leaves the
collection absent on an instance that has yet to run the migration.

This scope grants access to the MCP tools listed below for the consenting Paideuo account. The
authorization code expires after five minutes and is single-use. Access tokens last one hour,
and refreshing rotates both credentials. Refresh tokens expire after 30 days of inactivity. The
OAuth client can revoke the grant at `POST /api/paideuo/v1/mcp-oauth/revoke`.

### Tool behavior

The JSON-RPC 2.0 MCP endpoint is `POST /api/paideuo/v1/service/mcp` for service credentials and
`POST /api/paideuo/v1/mcp` for authenticated human sessions. It supports `tools/list` and
`tools/call`. Available tools are `list_programs`, `get_program`, `create_draft`,
`preview_import`, `commit_import`, `record_workout`, `submit_check_ins`, and `fetch_metrics`.

Read tools require `programs:read` or `metrics:read`. Mutations require `imports:commit` plus the
matching `programs:write`, `workouts:write`, `metrics:write`, or `recordings:write` scope.
`get_program` returns the owned program with blocks, slots, slot baselines, weeks,
prescriptions, and training components. Prescriptions reference their session slot by ID.
`preview_import` returns planned changes without writing domain records.

When `preview_import` returns `approvalRequired: true`, the program owner reviews the
proposed document and sends `{ "previewToken": "...", "document": { ... } }` to
`POST /api/paideuo/v1/imports/approve` with their authenticated Paideuo user session.
The owner can then provide the returned `approvalReceipt` to the client that calls
`commit_import` with the same preview token and document. Service credentials cannot issue
receipts. The receipt expires with the preview and applies to that owner, document, and
current program and schedule revision. This workflow also applies to the service HTTP import
commit endpoint. Identical imports with an empty write set need no approval.

`create_draft` creates a new program and rejects external IDs already owned by the caller.
`commit_import` is audited and can replay the original receipt using the same preview token or
a caller-provided `operationId`. Pass the same `operationId` when retrying a convenience
mutation. The tools reuse the schemas and transaction handling of the HTTP ingestion API.

Tool failures set `isError: true` and return the underlying status in `structuredContent.status`.
When batch diagnostics are available, `structuredContent.details` contains the row results and
rollback status.

Successful batches return `200` with `created`, `updated`, `skipped`, and `error` counts,
`rows`, `operationId`, `payloadHash`, and `audit`. Rows have a domain key and a status of
`created`, `updated`, or `skipped`.

A failed batch rolls back all writes and creates no receipt. Item validation failures return
`400`, conflicts and persistence failures return `409`, and unexpected planning failures return
`500`. Batch failures include `rolledBack: true`, zero success counts, and rows identifying
the input index and key when available. `error` counts only rows marked `error` or `conflict`.
Other rows are marked `not_committed`. The `code` field identifies the failure, including
`invalid_item`, `item_conflict`, `duplicate_target`, `planning_failed`, `write_failed`, and
`transaction_failed`. A program validation conflict can identify individual hierarchy records.
Invalid request envelopes, authentication and scope failures, and operation ID collisions use
the standard PocketBase error response.

## Versioning policy

- `schema` and `version` are mandatory, and unknown major versions are rejected.
- Version 1 changes must be backwards compatible. An existing valid document must continue to
  normalize to the same meaning.
- Optional fields and enum members may be added in a later revision only when omitted values have a
  defined version-1-compatible meaning.
- Field removal, semantic changes, required-field additions, or changes to existing ranges require a
  new version. Unknown fields remain invalid so clients discover spelling and version errors.
- Server implementations may support multiple versions concurrently during migration, but they
  must not silently reinterpret a document as another version.
