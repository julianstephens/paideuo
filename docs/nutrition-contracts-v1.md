# Nutrition contracts v1

The contracts and shared PocketBase services are implemented in NUT-01. Food-bank, recipe, nutrition plan, target, planned-food, consumed-food, and day-summary operations are available through HTTP and MCP. The contract catalog in `backend/pb_hooks/nutrition-contracts.cjs` defines each operation's request and response JSON Schema. Both adapters in `backend/pb_hooks/nutrition-adapters.cjs` call the same service.

## Operations

| Resource   | Operations                                               |
| ---------- | -------------------------------------------------------- |
| `foods`    | get, list, create, update, duplicate, set_archive        |
| `recipes`  | get, list, create, update, delete, for_entry             |
| `plans`    | get, list, create, update, delete                        |
| `targets`  | get, list, create, update, delete, resolve, resolve_bulk |
| `planned`  | get, list, create, update, delete, week, preview, commit |
| `consumed` | get, list, create, update, delete, batch_create          |
| `days`     | summary, summary_range                                   |

For example, `planned.create` maps to `POST /api/paideuo/v1/nutrition/planned/create` and the MCP tool `nutrition_planned_create`. HTTP accepts the operation input as a JSON body and returns the output directly. MCP accepts the same fields as tool arguments and returns the output as structured content. HTTP reads also use a JSON body so filters and cursors share the same schema with MCP. Lists use an opaque `next` ID as the next request's `after` cursor. Page sizes default to 50 and allow up to 100. Entity responses contain `id`, `externalId`, and `data`.

Creates require an `externalId` unique per owner and collection. Every write requires an `operationId` unique across the owner's nutrition operations. Identical requests replay the original response, even after a later edit or deletion. A reused operation ID with different input, an existing external ID for a new operation, or an occupied singleton or override slot produces a conflict. Deleting a recipe, plan, or override frees its singleton or selector slot. Deleting a plan also removes its overrides and leaves food entries intact. Food entries retain their external IDs after soft deletion.

The shared service reports invalid input as 400, missing authentication as 401, missing scope as 403, unavailable records as 404, and conflicts as 409. Map these statuses into MCP tool errors using the existing MCP convention. The owner comes from the authenticated principal. Human requests use the verified Paideuo user. Service credentials and OAuth principals require an explicit `nutrition:read` or `nutrition:write` grant for the corresponding operation. The collections are locked to the shared service at the record API level. Lookups, parent checks, and writes all use the principal's owner ID.

## Food bank

Use `POST /api/paideuo/v1/nutrition/foods/{operation}` with a Paideuo session or `POST /api/paideuo/v1/service/nutrition/foods/{operation}` with a service bearer token. The matching MCP tools are `nutrition_foods_{operation}`.

List filters apply before pagination. `search` matches title or description, `category` matches the exact trimmed category, and `status` accepts `active`, `archived`, or `all`. The explicit status takes precedence over `includeArchived`. Get accepts archived food IDs. For duplication, send the source `id`, new `externalId`, `title`, and `operationId`. It creates an active independent item and leaves recipe attachments with the source. Send `id`, `operationId`, and `archived` to `set_archive` to archive or restore.

With ChatGPT OAuth, request `paideuo:mcp` plus `nutrition:read` for list and get or `nutrition:write` for mutations. Request both for the full workflow. Existing connections need new consent to gain either nutrition scope. Refresh can drop nutrition scopes and retains only the resulting grant.

## Recipe attachments

Use the same HTTP prefixes with `recipes/{operation}`, or `nutrition_recipes_{operation}` through MCP. List with `foodId` to find the optional attachment for an owned food. Each food can have one recipe. On create and update, send ingredients in display order. Each ingredient needs a name and may include prep details. Provide quantity and unit together for measured ingredients. Update replaces the attachment fields, so omitting instructions or portions clears them. Ingredient quantities and recipe portions describe preparation and never affect per-serving estimates.

`recipes.for_entry` accepts `entryKind` (`planned` or `consumed`) and `entryId`, and returns `{ recipe }`. The value is the food's current attachment or `null` for an owned entry with no attachment. Bank-backed entries retain recipe access after food archiving. Consumption from a planned snapshot follows the planned entry's bank provenance even after soft deletion of that planned entry. Inline substitutions use their own provenance. Recipe edits and removal never rewrite food or entry snapshots.

## Dates, activation, and targets

Dates are Gregorian civil dates in `YYYY-MM-DD` format. Program-relative entries use the program schedule's configured IANA timezone. Standalone entries supply their timezone, or inherit it from their linked planned entry when available. A consumed timestamp must specify a UTC offset or `Z`. The service derives the civil date in the entry timezone when only a timestamp is supplied and validates that both agree when supplied together. The entry stores its date and timezone. Date corrections are explicit, and rescheduling a program does not move food entries.

Resolve a target with `programId` and `date`. A scheduled program applies its own targets, including when other programs overlap. Within its scheduled date range, precedence is program default, block, week, weekday within that week, then exact date. Weekday uses ISO numbering (Monday is 1). Block and week selectors follow those records on reschedule. Exact-date selectors remain attached to their civil dates and apply only while inside the schedule. Unscheduled programs and out-of-window dates resolve without an active plan.

`targets.resolve_bulk` takes `programId`, `startDate`, and `endDate`. It returns `{ days: [{ date, target }] }` in ascending order, including inactive dates. The inclusive range accepts up to 62 civil days. Each `target` is identical to the single-date response. The same operation is available to owner-scoped service credentials and as `nutrition_targets_resolve_bulk` in MCP.

Activation starts off and follows the last matching layer with an explicit `active` flag. Set it to `false` for an off period and `true` to re-enable at a more specific layer. Each macro resolves independently. Omit a field to inherit, use `null` to intentionally clear, and supply a number to set it. Plan and target updates replace the editable layer so clients can restore inheritance by omitting a previously set field. Effective targets include each value and its source record and selector kind, including the source of explicit clears. Off periods return `macros: null` and carry no target or compliance expectation.

## Food snapshots and totals

Food-bank macros describe one serving, using kcal for `calories` and grams for `protein`, `carbohydrate`, and `fat`. Recipes contain preparation data and have no effect on estimates. Entry creation captures the food title, serving description, size, unit, and estimated per-serving macros. Bank entries retain the bank ID. Inline entries store their own snapshot. Logging a planned item captures its snapshot and retains its ID. Substitutions use a bank or inline snapshot and may retain the planned ID. Entry records also capture creator and last editor principal references.

Entry updates edit fields such as quantity, date, or macros while preserving the original snapshot and provenance. A supplied `overrides` object replaces the previous overrides. A numeric override applies to the entire entry, `null` clears that entry's estimate, and an omitted macro uses the captured per-serving estimate. An empty override object restores all captured estimates. Archiving a food hides it from default lists and prevents new bank selections. Planned entries can be canceled and restored with `canceled`. Canceled and deleted planned entries cannot be newly logged through their plan link. Deleting food entries hides them from reads and totals without removing their snapshots or linked consumption.

Values accept up to three decimal places. Serving and recipe quantities are limited to 1,000 and individual macro estimates and overrides to 1,000,000. Arithmetic uses thousandths, rounds each calculated entry amount half up to three places, and sums the rounded amounts independently. Daily summaries report owner-wide planned and consumed totals for the requested date, plus the target for the explicitly selected program when provided. Each total reports its eligible entry count and, per macro, the subtotal of known values and their count. An unknown subtotal is `null`. A known zero contributes to coverage. Subjective nutrition check-ins and their existing quantitative fields continue to use the check-in APIs and metrics.

## Planned-food scheduling

The meal planner opens from Nutrition or an active target preview. The planner links to the food bank. Use `planned.create` with `{ operationId, externalId, data }` to schedule one entry. The data supplies `date`, `quantity`, and either a bank or inline source. It can also include `programId`, `timezone`, `meal`, `order`, `overrides`, and `notes`. Use `planned.update` with `{ operationId, id, data }` to move an entry by changing its date or reorder it by changing its order. A null meal label clears it. Entries with equal order are shown in record ID order.

`planned.week` accepts `{ startDate, programId? }` and returns seven consecutive civil days with ordered owner-wide entries, planned subtotals, the selected program's effective target, and remaining macros. A configured remaining macro is target minus the planned subtotal. An empty day uses zero planned for that difference. Unknown estimates on a populated day leave the corresponding remaining value null. Canceled entries are visible for reference and excluded from totals.

Send one of these batch inputs to `planned.preview`:

- `{ kind: "schedule", entries: [{ externalId, data }, ...] }` schedules new entries and captures current estimates.
- `{ kind: "copy", id, destinationDate }` copies an existing active entry with its captured snapshot.
- `{ kind: "clone", startDate, endDate, destinationDate }` copies an inclusive range of up to 62 civil days, preserving gaps and skipping canceled and deleted entries. Each copied entry retains its source program and timezone.

A batch adds between 1 and 100 entries. Preview returns `{ previewToken, additions, destinations }`, including existing rows on dates that will receive additions. Review the additions and send `{ operationId, previewToken, batch }` to `planned.commit` with the exact batch input. Commit appends after existing rows and returns `{ items: [{ id, externalId }, ...] }`. A preview is owner-bound and expires after 15 minutes. If the proposed additions or destination rows change before commit, preview again after the conflict. An identical retry of a successful operation returns its receipt even after expiry. Preview requires `nutrition:read` and commit requires `nutrition:write`.

## Consumed-food logging

In Nutrition, use **Log food** for a bank food or a one-off and **Log eaten** on a planned row to record a portion. The daily log and macro comparison use actual entries independently of the schedule. A day with no logs has a zero entry count and null consumed subtotals. On populated days the total reports a known subtotal and coverage for each macro.

`consumed.create` takes `{ operationId, externalId, data }`. Data requires a serving quantity and a source. Send `{ kind: "bank", foodId }` or `{ kind: "inline", food }` for independent foods or substitutions. To use the snapshot of a planned food, send `{ kind: "planned" }` and `plannedId`. Include `plannedId` with a bank or inline substitution to preserve the planned link. Each portion uses its own external ID and operation ID. The link provides a default date and timezone when applicable.

Supply an explicit civil date, an offset-bearing `consumedAt` timestamp, or both when they agree in the entry timezone. A timestamp can establish the date when omitted. Edits preserve the snapshot, source and planned link. Send `consumedAt: null` on update to clear the timestamp before or alongside a date correction. Each numeric macro override is an estimate for the entire eaten entry, independent of serving quantity. Use null to mark a macro unknown or omit it from the overrides object to use its captured estimate.

`consumed.list` supports optional `date` and `plannedId` filters together with the standard cursor. It can find existing portions linked to an owned, soft-deleted plan entry. Use `consumed.delete` to undo an eaten entry. The deleted log retains its external ID and is removed from reads and totals.

`consumed.batch_create` takes `{ operationId, entries: [{ externalId, data }, ...] }` with 1–100 new portions. The batch validates each entry as an individual create, writes all entries in one transaction, and returns `{ items: [{ id, externalId }, ...] }` in input order. An identical retry replays the saved receipt. A conflicting ID or invalid entry aborts the whole batch.

`days.summary` takes `{ date, programId? }` and returns the selected civil date, the program's effective target when selected, and independent owner-wide planned and consumed totals. Consumed reads and summaries require `nutrition:read`. Single and batch writes require `nutrition:write`. The matching tools use names such as `nutrition_consumed_batch_create` and `nutrition_days_summary`.

`days.summary_range` takes `{ startDate, endDate, programId? }` and returns `{ days }` with a daily summary for every date in an inclusive range of up to 62 civil days. The training calendar uses this operation to display planned and eaten totals in week and month views.
