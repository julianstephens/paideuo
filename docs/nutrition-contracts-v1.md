# Nutrition contracts v1

The contracts and shared PocketBase services are implemented in NUT-01. The feature issues will register the operations with the production HTTP and MCP dispatchers. The contract catalog in `backend/pb_hooks/nutrition-contracts.cjs` defines each operation's request and response JSON Schema. Both adapters in `backend/pb_hooks/nutrition-adapters.cjs` call the same service.

## Operations

| Resource              | Operations                                 |
| --------------------- | ------------------------------------------ |
| `foods`               | get, list, create, update                  |
| `recipes`             | get, list, create, update, delete          |
| `plans`               | get, list, create, update                  |
| `targets`             | get, list, create, update, delete, resolve |
| `planned`, `consumed` | get, list, create, update, delete          |
| `days`                | summary                                    |

For example, `planned.create` maps to `POST /api/paideuo/v1/nutrition/planned/create` and the MCP tool `nutrition_planned_create`. HTTP accepts the operation input as a JSON body and returns the output directly. MCP accepts the same fields as tool arguments and returns the output as structured content. HTTP reads also use a JSON body so filters and cursors share the same schema with MCP. Lists use an opaque `next` ID as the next request's `after` cursor. Page sizes default to 50 and allow up to 100. Entity responses contain `id`, `externalId`, and `data`.

Creates require an `externalId` unique per owner and collection. Every write requires an `operationId` unique across the owner's nutrition operations. Identical requests replay the original response, even after a later edit or deletion. A reused operation ID with different input, an existing external ID for a new operation, or an occupied singleton or override slot produces a conflict. Recipe and target deletion frees their singleton or selector slot. Food entries retain their external IDs after soft deletion.

The shared service reports invalid input as 400, missing authentication as 401, missing scope as 403, unavailable records as 404, and conflicts as 409. Map these statuses into MCP tool errors using the existing MCP convention. The owner comes from the authenticated principal. Human requests use the verified Paideuo user. Service credentials and OAuth principals require an explicit `nutrition:read` or `nutrition:write` grant for the corresponding operation. The collections are locked to the shared service at the record API level. Lookups, parent checks, and writes all use the principal's owner ID.

## Dates, activation, and targets

Dates are Gregorian civil dates in `YYYY-MM-DD` format. Program-relative entries use the program schedule's configured IANA timezone. Standalone entries supply their timezone, or inherit it from their linked planned entry when available. A consumed timestamp must specify a UTC offset or `Z`. The service derives the civil date in the entry timezone when only a timestamp is supplied and validates that both agree when supplied together. The entry stores its date and timezone. Date corrections are explicit, and rescheduling a program does not move food entries.

Resolve a target with `programId` and `date`. A scheduled program applies its own targets, including when other programs overlap. Within its scheduled date range, precedence is program default, block, week, weekday within that week, then exact date. Weekday uses ISO numbering (Monday is 1). Block and week selectors follow those records on reschedule. Exact-date selectors remain attached to their civil dates and apply only while inside the schedule. Unscheduled programs and out-of-window dates resolve without an active plan.

Activation starts off and follows the last matching layer with an explicit `active` flag. Set it to `false` for an off period and `true` to re-enable at a more specific layer. Each macro resolves independently. Omit a field to inherit, use `null` to intentionally clear, and supply a number to set it. Plan and target updates replace the editable layer so clients can restore inheritance by omitting a previously set field. Effective targets include each value and its source record and selector kind, including the source of explicit clears. Off periods return `macros: null` and carry no target or compliance expectation.

## Food snapshots and totals

Food-bank macros describe one serving, using kcal for `calories` and grams for `protein`, `carbohydrate`, and `fat`. Recipes contain preparation data and have no effect on estimates. Entry creation captures the food title, serving description, size, unit, and estimated per-serving macros. Bank entries retain the bank ID. Inline entries store their own snapshot. Logging a planned item captures its snapshot and retains its ID. Substitutions use a bank or inline snapshot and may retain the planned ID. Entry records also capture creator and last editor principal references.

Entry updates edit fields such as quantity, date, or macros while preserving the original snapshot and provenance. A supplied `overrides` object replaces the previous overrides. A numeric override applies to the entire entry, `null` clears that entry's estimate, and an omitted macro uses the captured per-serving estimate. An empty override object restores all captured estimates. Archiving a food hides it from default lists and prevents new bank selections. Planned entries can be canceled and restored with `canceled`. Canceled and deleted planned entries cannot be newly logged through their plan link. Deleting food entries hides them from reads and totals without removing their snapshots or linked consumption.

Values accept up to three decimal places. Serving and recipe quantities are limited to 1,000 and individual macro estimates and overrides to 1,000,000. Arithmetic uses thousandths, rounds each calculated entry amount half up to three places, and sums the rounded amounts independently. Daily summaries report owner-wide planned and consumed totals for the requested date, plus the target for the explicitly selected program when provided. Each total reports its eligible entry count and, per macro, the subtotal of known values and their count. An unknown subtotal is `null`. A known zero contributes to coverage. Subjective nutrition check-ins and their existing quantitative fields continue to use the check-in APIs and metrics.
