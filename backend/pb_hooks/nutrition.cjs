/* oxlint-disable import/no-commonjs */

const {
  contractFor,
  matches,
  maxTargetDays,
  maxPlannedBatch,
} = require("./nutrition-contracts.cjs");
const {
  targetSource,
  resolveTargets,
  summarize,
  canonical,
  remainingMacros,
} = require("./nutrition-domain.cjs");
const dates = require("./calendar-dates.js");
const credentials = require("./service-credentials.cjs");
const categories = require("./food-categories.cjs");
const { reserve } = require("./nutrition-rate-limit.cjs");

const collection = (kind) => "paideuo_nutrition_" + kind;
const find = (db, name, filter, params, sort = "", limit = 0) =>
  db.findRecordsByFilter(name, filter, sort, limit, 0, params);
const first = (...args) => find(...args, "", 1)[0];
const owned = (db, name, owner, id) => {
  const record = first(db, name, "owner = {:owner} && id = {:id}", { owner, id });
  if (!record) throw new NotFoundError("Nutrition resource not found.");
  return record;
};
const dataOf = (record) => JSON.parse(record.getString("data"));
const resultOf = (record) => ({
  id: record.id,
  externalId: record.getString("external_id"),
  data: dataOf(record),
});
const isEntry = (kind) => kind === "planned" || kind === "consumed";
const entryRecord = (db, kind, owner, id, includeDeleted = false) => {
  const record = owned(db, collection(kind), owner, id);
  if (!includeDeleted && isEntry(kind) && dataOf(record).deleted) {
    throw new NotFoundError("Nutrition entry not found.");
  }
  return record;
};
const civilDate = (value) => {
  const parsed = dates.parse(value);
  if (!parsed) throw new BadRequestError("Provide a valid civil date (YYYY-MM-DD).");
  return parsed;
};
const timezoneFor = (value) => {
  if (!dates.validTimezone(value)) throw new BadRequestError("Provide a valid IANA timezone.");
  return value;
};
const dateOfTimestamp = (value, timezone) => {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new BadRequestError("Provide a valid timestamp with a UTC offset.");
  }
  civilDate(value.slice(0, 10));
  return new DateTime(new Date(value).toISOString())
    .time()
    .in(new Timezone(timezone))
    .format("2006-01-02");
};

const scheduleFor = (db, programId) =>
  first(db, "paideuo_program_schedules", "program = {:programId}", { programId });
const blocksFor = (db, programId) =>
  find(db, "paideuo_blocks", "program = {:programId}", { programId }, "position,id");
const dayMilliseconds = 86400000;

const programWindow = (db, programId) => {
  const schedule = scheduleFor(db, programId);
  if (!schedule) return null;
  const weeks = find(db, "paideuo_program_weeks", "block.program = {:programId}", { programId });
  return {
    start: civilDate(schedule.getString("start_date")),
    blocks: blocksFor(db, programId),
    weeks: new Map(
      weeks.map((week) => [week.getString("block") + ":" + week.getInt("position"), week.id]),
    ),
  };
};

const dayInProgram = (window, day) => {
  if (!window) return null;
  let offset = Math.floor((day.getTime() - window.start.getTime()) / dayMilliseconds);
  if (offset < 0) return null;
  for (const block of window.blocks) {
    const duration = block.getInt("duration_weeks") * 7;
    if (offset < duration) {
      const position = Math.floor(offset / 7) + 1;
      return {
        blockId: block.id,
        weekId: window.weeks.get(block.id + ":" + position),
        weekday: day.getUTCDay() || 7,
      };
    }
    offset -= duration;
  }
  return null;
};

const selectorKey = (selector) => {
  switch (selector.kind) {
    case "block":
      return "block:" + selector.blockId;
    case "week":
      return "week:" + selector.weekId;
    case "weekday":
      return "weekday:" + selector.weekId + ":" + selector.weekday;
    case "date":
      return "date:" + selector.date;
  }
};
const validateSelector = (db, programId, selector) => {
  if (selector.kind === "date") {
    if (!dayInProgram(programWindow(db, programId), civilDate(selector.date))) {
      throw new BadRequestError("Date override must fall within the scheduled program.");
    }
    return;
  }
  const blocks = blocksFor(db, programId);
  const belongs =
    selector.kind === "block"
      ? blocks.some((block) => block.id === selector.blockId)
      : Boolean(
          first(db, "paideuo_program_weeks", "id = {:id} && block.program = {:program}", {
            id: selector.weekId,
            program: programId,
          }),
        );
  if (!belongs) throw new NotFoundError("Training block or week not found.");
};

const targetContext = (db, owner, programId) => {
  if (!programId) return null;
  owned(db, "paideuo_programs", owner, programId);
  const plan = first(db, collection("plans"), "owner = {:owner} && program = {:programId}", {
    owner,
    programId,
  });
  const window = plan && programWindow(db, programId);
  if (!window) return null;
  const overrides = find(db, collection("targets"), "owner = {:owner} && plan = {:plan}", {
    owner,
    plan: plan.id,
  });
  return {
    window,
    base: { source: targetSource("program", plan.id), data: dataOf(plan) },
    overrides: new Map(
      overrides.map((record) => {
        const data = dataOf(record);
        return [
          record.getString("selector"),
          { source: targetSource(data.selector.kind, record.id), data },
        ];
      }),
    ),
  };
};

const effective = (context, date) => {
  const day = context && dayInProgram(context.window, date);
  if (!day) return resolveTargets([]);
  const layers = [context.base];
  const selectors = [{ kind: "block", blockId: day.blockId }];
  if (day.weekId) {
    selectors.push({ kind: "week", weekId: day.weekId });
    selectors.push({ kind: "weekday", weekId: day.weekId, weekday: day.weekday });
  }
  selectors.push({ kind: "date", date: dates.format(date) });
  for (const selector of selectors) {
    const layer = context.overrides.get(selectorKey(selector));
    if (layer) layers.push(layer);
  }
  return resolveTargets(layers);
};

const resolveBulk = (db, owner, input) => {
  const start = civilDate(input.startDate).getTime();
  const end = civilDate(input.endDate).getTime();
  if (end < start || end - start >= maxTargetDays * dayMilliseconds) {
    throw new BadRequestError("Provide an ordered range of up to " + maxTargetDays + " days.");
  }
  const context = targetContext(db, owner, input.programId);
  const days = [];
  for (let time = start; time <= end; time += dayMilliseconds) {
    const date = new Date(time);
    days.push({ date: dates.format(date), target: effective(context, date) });
  }
  return { days };
};

const capture = (db, owner, source, planned) => {
  if (source.kind === "inline")
    return { source: { kind: "inline" }, snapshot: foodData(source.food) };
  if (source.kind === "planned") {
    if (!planned) throw new BadRequestError("Provide the linked planned entry.");
    return { source, snapshot: planned.snapshot };
  }
  const food = dataOf(owned(db, collection("foods"), owner, source.foodId));
  if (food.archived) throw new BadRequestError("Archived food cannot be selected.");
  const { title, serving, macros } = food;
  return { source, snapshot: { title, serving, macros } };
};

const setEntryDate = (entry, requestedDate) => {
  const fromTimestamp = entry.consumedAt && dateOfTimestamp(entry.consumedAt, entry.timezone);
  const date = requestedDate ?? fromTimestamp;
  civilDate(date);
  if (fromTimestamp && fromTimestamp !== date) {
    throw new BadRequestError("Consumption timestamp must fall on the entry date.");
  }
  entry.date = date;
};

const createEntry = (db, principal, data) => {
  const owner = principal.ownerId;
  const planned = data.plannedId && dataOf(entryRecord(db, "planned", owner, data.plannedId));
  if (planned?.canceled) throw new BadRequestError("Canceled food cannot be marked eaten.");
  const programId = data.programId ?? planned?.programId;
  if (programId) owned(db, "paideuo_programs", owner, programId);
  const schedule = programId && scheduleFor(db, programId);
  const timezone = timezoneFor(
    schedule?.getString("timezone") ?? data.timezone ?? planned?.timezone,
  );
  if (data.timezone && data.timezone !== timezone) {
    throw new BadRequestError("Use the configured program timezone.");
  }
  const entry = {
    ...data,
    ...capture(db, owner, data.source, planned),
    timezone,
    createdBy: principal.credentialRef,
    updatedBy: principal.credentialRef,
  };
  if (programId) entry.programId = programId;
  setEntryDate(entry, data.date ?? (data.consumedAt ? undefined : planned?.date));
  return entry;
};

const parentSpecs = {
  recipes: { key: "foodId", field: "food", name: collection("foods") },
  plans: { key: "programId", field: "program", name: "paideuo_programs" },
  targets: { key: "planId", field: "plan", name: collection("plans") },
};
const foodData = (data) => {
  const title = data.title.trim();
  const description = data.serving.description.trim();
  const unit = data.serving.unit.trim();
  if (!title || !description || !unit) {
    throw new BadRequestError("Provide a title, serving description, and serving unit.");
  }
  return {
    ...data,
    title,
    serving: { ...data.serving, description, unit },
    ...(data.category === undefined ? {} : { category: data.category.trim() }),
  };
};

const recipeData = (data) => ({
  ...data,
  ingredients: data.ingredients.map((ingredient) => {
    const name = ingredient.name.trim();
    const unit = ingredient.unit?.trim();
    if (!name || (ingredient.quantity !== undefined && !unit)) {
      throw new BadRequestError(
        "Provide an ingredient name and a unit for each measured ingredient.",
      );
    }
    return { ...ingredient, name, ...(unit === undefined ? {} : { unit }) };
  }),
});

const conflict = (message) => new ApiError(409, message);

const externalIdInUse = (db, kind, owner, externalId) =>
  first(db, collection(kind), "owner = {:owner} && external_id = {:id}", {
    owner,
    id: externalId,
  });

const create = (db, principal, kind, input) => {
  if (!input.externalId) throw new BadRequestError("Provide an external ID for the new resource.");
  const owner = principal.ownerId;
  const name = collection(kind);
  const parent = parentSpecs[kind];
  const fields = { owner, external_id: input.externalId };
  let data = kind === "foods" ? foodData(input.data) : input.data;

  if (externalIdInUse(db, kind, owner, input.externalId)) {
    throw conflict("External ID is already in use.");
  }
  if (parent) {
    const parentId = input[parent.key];
    const parentRecord = owned(db, parent.name, owner, parentId);
    fields[parent.field] = parentId;
    data = { ...data, [parent.key]: parentId };

    let filter = "owner = {:owner} && " + parent.field + " = {:parentId}";
    const params = { owner, parentId };
    if (kind === "targets") {
      validateSelector(db, parentRecord.getString("program"), data.selector);
      fields.selector = selectorKey(data.selector);
      params.selector = fields.selector;
      filter += " && selector = {:selector}";
    }
    if (first(db, name, filter, params)) throw conflict("Nutrition resource already exists.");
  }
  if (kind === "recipes") data = recipeData(data);
  if (isEntry(kind)) {
    data = createEntry(db, principal, data);
    fields.date = data.date;
  }
  const record = new Record(db.findCollectionByNameOrId(name), { ...fields, data });
  db.save(record);
  return resultOf(record);
};

const upsert = (db, principal, kind, input) => {
  const parent = parentSpecs[kind];
  const owner = principal.ownerId;
  const parentId = input[parent.key];
  owned(db, parent.name, owner, parentId);
  let filter = "owner = {:owner} && " + parent.field + " = {:parentId}";
  const params = { owner, parentId };
  const { selector, ...layer } = input.data;
  if (kind === "targets") {
    filter += " && selector = {:selector}";
    params.selector = selectorKey(selector);
  }
  const record = first(db, collection(kind), filter, params);
  if (!record) return create(db, principal, kind, input);
  return mutate(db, principal, kind, "update", { id: record.id, data: layer });
};

const mutate = (db, principal, kind, action, input) => {
  if (kind === "categories") return categories.change(db, principal.ownerId, action, input);
  if (action === "upsert") return upsert(db, principal, kind, input);
  if (action === "commit") return commitPlanned(db, principal, input);
  if (action === "batch_create") {
    return {
      items: input.entries.map((entry) => {
        const { id, externalId } = create(db, principal, kind, entry);
        return { id, externalId };
      }),
    };
  }
  if (action === "create") return create(db, principal, kind, input);
  const record = entryRecord(db, kind, principal.ownerId, input.id, action === "delete");
  if (action === "delete" && !isEntry(kind)) {
    db.delete(record);
    return { id: record.id };
  }
  const previous = dataOf(record);
  let data = action === "delete" ? { ...previous, deleted: true } : { ...previous, ...input.data };
  if (kind === "foods") {
    if (action === "duplicate") {
      return create(db, principal, kind, {
        externalId: input.externalId,
        data: { ...previous, title: input.title, archived: false },
      });
    }
    data = action === "set_archive" ? { ...previous, archived: input.archived } : foodData(data);
  }
  if (kind === "recipes") data = recipeData({ ...input.data, foodId: previous.foodId });
  // The whole target layer is replaced so an omitted field can resume inheritance.
  if (kind === "plans") data = { programId: previous.programId, ...input.data };
  if (kind === "targets") {
    data = { planId: previous.planId, selector: previous.selector, ...input.data };
  }
  if (isEntry(kind)) {
    if (data.meal === null) delete data.meal;
    if (data.consumedAt === null) delete data.consumedAt;
    setEntryDate(data, input.data?.date ?? (input.data?.consumedAt ? undefined : previous.date));
    data.updatedBy = principal.credentialRef;
    record.set("date", data.date);
  }
  record.set("data", data);
  db.save(record);
  return action === "delete" ? { id: record.id } : resultOf(record);
};

const list = (db, kind, owner, input) => {
  const filters = ["owner = {:owner}"];
  const params = { owner };
  if (input.plannedId) {
    entryRecord(db, "planned", owner, input.plannedId, true);
    params.plannedId = input.plannedId;
    filters.push("data.plannedId = {:plannedId}");
  }
  const parent = parentSpecs[kind];
  if (parent && input[parent.key]) {
    params.parent = input[parent.key];
    owned(db, parent.name, owner, params.parent);
    filters.push(parent.field + " = {:parent}");
  }
  if (input.startDate || input.endDate) {
    if (input.date || !input.startDate || !input.endDate)
      throw new BadRequestError("Provide either one date or both date range bounds.");
    const start = civilDate(input.startDate).getTime();
    const end = civilDate(input.endDate).getTime();
    if (end < start || end - start >= maxTargetDays * dayMilliseconds)
      throw new BadRequestError("Provide an ordered range of up to " + maxTargetDays + " days.");
    Object.assign(params, { startDate: input.startDate, endDate: input.endDate });
    filters.push("date >= {:startDate} && date <= {:endDate}");
  }
  if (input.date) {
    civilDate(input.date);
    params.date = input.date;
    filters.push("date = {:date}");
  }
  if (input.after) {
    params.after = input.after;
    filters.push("id > {:after}");
  }
  if (isEntry(kind)) filters.push("(data.deleted = null || data.deleted = false)");
  if (kind === "foods") {
    const status = input.status ?? (input.includeArchived ? "all" : "active");
    if (status === "active") filters.push("(data.archived = null || data.archived = false)");
    if (status === "archived") filters.push("data.archived = true");
    if (input.search?.trim()) {
      params.search = input.search.trim();
      filters.push("(data.title ~ {:search} || data.description ~ {:search})");
    }
    if (input.category?.trim()) {
      params.category = input.category.trim();
      filters.push("data.category = {:category}");
    }
  }
  const limit = input.limit ?? 50;
  const rows = find(db, collection(kind), filters.join(" && "), params, "id", limit + 1);
  const items = rows.slice(0, limit).map(resultOf);
  return { items, next: rows.length > limit ? items[limit - 1].id : null };
};

const entriesByDate = (db, kind, owner, start, end) => {
  const grouped = new Map();
  const rows = find(
    db,
    collection(kind),
    "owner = {:owner} && date >= {:start} && date <= {:end}",
    { owner, start, end },
  );
  for (const record of rows) {
    const data = dataOf(record);
    if (data.deleted || data.canceled) continue;
    const date = record.getString("date");
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(data);
  }
  return grouped;
};

const readDailyNutrition = (db, owner, { startDate, endDate, programId }) => {
  const start = civilDate(startDate).getTime();
  const end = civilDate(endDate).getTime();
  const context = targetContext(db, owner, programId);
  const planned = entriesByDate(db, "planned", owner, startDate, endDate);
  const consumed = entriesByDate(db, "consumed", owner, startDate, endDate);
  const days = [];
  for (let time = start; time <= end; time += dayMilliseconds) {
    const day = new Date(time);
    const date = dates.format(day);
    days.push({
      date,
      target: effective(context, day),
      planned: summarize(planned.get(date) ?? []),
      consumed: summarize(consumed.get(date) ?? []),
    });
  }
  return { days };
};

const summarizeRange = (db, owner, input) => {
  const { startDate, endDate } = input;
  const start = civilDate(startDate).getTime();
  const end = civilDate(endDate).getTime();
  if (end < start || end - start >= maxTargetDays * dayMilliseconds) {
    throw new BadRequestError("Provide an ordered range of up to " + maxTargetDays + " days.");
  }
  return readDailyNutrition(db, owner, input);
};

const shiftDay = (date, offset) => {
  const shifted = dates.format(new Date(civilDate(date).getTime() + offset * dayMilliseconds));
  civilDate(shifted);
  return shifted;
};

const plannedRange = (db, owner, start, end) =>
  find(
    db,
    collection("planned"),
    "owner = {:owner} && date >= {:start} && date <= {:end} && (data.deleted = null || data.deleted = false)",
    { owner, start, end },
    "date,id",
  )
    .map(resultOf)
    .sort((a, b) =>
      a.data.date < b.data.date
        ? -1
        : a.data.date > b.data.date
          ? 1
          : (a.data.order ?? 0) - (b.data.order ?? 0),
    );

const plannedWeek = (db, owner, { startDate, programId }) => {
  const entries = plannedRange(db, owner, startDate, shiftDay(startDate, 6));
  const context = targetContext(db, owner, programId);
  return {
    days: Array.from({ length: 7 }, (_, index) => {
      const date = shiftDay(startDate, index);
      const dayEntries = entries.filter((entry) => entry.data.date === date);
      const planned = summarize(
        dayEntries.filter(({ data }) => !data.canceled).map(({ data }) => data),
      );
      const target = effective(context, civilDate(date));
      return {
        date,
        entries: dayEntries,
        planned,
        target,
        remaining: remainingMacros(planned, target),
      };
    }),
  };
};

const cloneSources = (db, owner, batch) => {
  if (batch.kind === "copy") {
    const entry = resultOf(entryRecord(db, "planned", owner, batch.id));
    if (entry.data.canceled) throw new BadRequestError("Canceled food cannot be copied.");
    civilDate(batch.destinationDate);
    return [entry];
  }
  const span = (civilDate(batch.endDate) - civilDate(batch.startDate)) / dayMilliseconds;
  if (span < 0 || span >= maxTargetDays) {
    throw new BadRequestError(
      "Provide an ordered source range of up to " + maxTargetDays + " days.",
    );
  }
  shiftDay(batch.destinationDate, span);
  return plannedRange(db, owner, batch.startDate, batch.endDate).filter(
    ({ data }) => !data.canceled,
  );
};

const plannedPreviewPrefix = "paideuo:nutrition-planned-preview:";
const plannedFingerprint = (value) => $security.sha256(JSON.stringify(canonical(value)));

const preparePlanned = (db, owner, batch, token) => {
  const principal = { ownerId: owner, credentialRef: "preview" };
  let additions;
  if (batch.kind === "schedule") {
    additions = batch.entries
      .map(({ externalId, data }) => ({
        externalId,
        data: createEntry(db, principal, data),
      }))
      .sort((a, b) => (a.data.order ?? 0) - (b.data.order ?? 0));
  } else {
    const sources = cloneSources(db, owner, batch);
    const start = batch.kind === "clone" ? civilDate(batch.startDate) : null;
    additions = sources.map(({ data }, index) => ({
      externalId: "copy:" + token + ":" + index,
      data: {
        ...data,
        date: shiftDay(
          batch.destinationDate,
          start ? (civilDate(data.date) - start) / dayMilliseconds : 0,
        ),
        createdBy: principal.credentialRef,
        updatedBy: principal.credentialRef,
      },
    }));
  }
  if (!additions.length || additions.length > maxPlannedBatch) {
    throw new BadRequestError(
      "A batch must add between 1 and " + maxPlannedBatch + " planned entries.",
    );
  }
  if (new Set(additions.map(({ externalId }) => externalId)).size !== additions.length) {
    throw conflict("Batch external IDs must be unique.");
  }
  const byDate = new Map();
  for (const addition of additions) {
    if (externalIdInUse(db, "planned", owner, addition.externalId)) {
      throw conflict("External ID is already in use.");
    }
    const date = addition.data.date;
    if (!byDate.has(date)) {
      const entries = plannedRange(db, owner, date, date);
      const nextOrder = entries.reduce(
        (next, { data }) => Math.max(next, (data.order ?? 0) + 1),
        0,
      );
      byDate.set(date, { date, entries, nextOrder });
    }
    const destination = byDate.get(date);
    if (destination.nextOrder > 1000000)
      throw conflict("The destination has no remaining order positions.");
    addition.data.order = destination.nextOrder++;
  }
  return {
    additions,
    destinations: [...byDate.values()].map(({ date, entries }) => ({ date, entries })),
  };
};

const previewPlanned = (db, owner, batch) => {
  const previewToken = $security.sha256($security.randomString(64));
  const prepared = preparePlanned(db, owner, batch, previewToken);
  const store = db.store();
  const now = Date.now();
  const active = [];
  for (const [key, value] of Object.entries(store.getAll())) {
    if (!key.startsWith(plannedPreviewPrefix)) continue;
    const { expiresAt } = JSON.parse(value);
    if (expiresAt <= now) store.remove(key);
    else active.push({ key, expiresAt });
  }
  if (active.length >= 10000) {
    active.sort((a, b) => a.expiresAt - b.expiresAt);
    store.remove(active[0].key);
  }
  store.set(
    plannedPreviewPrefix + previewToken,
    JSON.stringify({
      owner,
      expiresAt: now + 15 * 60 * 1000,
      fingerprint: plannedFingerprint([batch, prepared]),
    }),
  );
  return { previewToken, ...prepared };
};

const commitPlanned = (db, principal, { previewToken, batch }) => {
  const owner = principal.ownerId;
  const preview = JSON.parse(db.store().get(plannedPreviewPrefix + previewToken) ?? "null");
  const stale = () => conflict("This planned-food preview is stale. Preview the batch again.");
  if (!preview || preview.owner !== owner || preview.expiresAt <= Date.now()) throw stale();
  let prepared;
  try {
    prepared = preparePlanned(db, owner, batch, previewToken);
  } catch (error) {
    if (
      error instanceof ApiError ||
      error instanceof BadRequestError ||
      error instanceof NotFoundError
    )
      throw stale();
    throw error;
  }
  if (preview.fingerprint !== plannedFingerprint([batch, prepared])) throw stale();
  const target = db.findCollectionByNameOrId(collection("planned"));
  const items = prepared.additions.map(({ externalId, data }) => {
    const record = new Record(target, {
      owner,
      external_id: externalId,
      date: data.date,
      data: { ...data, createdBy: principal.credentialRef, updatedBy: principal.credentialRef },
    });
    db.save(record);
    return { id: record.id, externalId };
  });
  return { items };
};

const recipeForEntry = (db, owner, { entryKind, entryId }) => {
  let { source, plannedId } = dataOf(entryRecord(db, entryKind, owner, entryId));
  if (source.kind === "planned" && plannedId) {
    source = dataOf(entryRecord(db, "planned", owner, plannedId, true)).source;
  }
  if (source.kind !== "bank") return { recipe: null };
  const record = first(db, collection("recipes"), "owner = {:owner} && food = {:food}", {
    owner,
    food: source.foodId,
  });
  return { recipe: record ? resultOf(record) : null };
};

const read = (db, owner, kind, action, input) => {
  if (kind === "categories") return categories.list(db, owner);
  if (action === "week") return plannedWeek(db, owner, input);
  if (action === "preview") return previewPlanned(db, owner, input);
  if (action === "get") return resultOf(entryRecord(db, kind, owner, input.id));
  if (action === "list") return list(db, kind, owner, input);
  if (action === "for_entry") return recipeForEntry(db, owner, input);
  if (action === "resolve_bulk") return resolveBulk(db, owner, input);
  if (action === "summary_range") return summarizeRange(db, owner, input);
  if (action === "summary") {
    return summarizeRange(db, owner, { ...input, startDate: input.date, endDate: input.date })
      .days[0];
  }
  return effective(targetContext(db, owner, input.programId), civilDate(input.date));
};

const execute = (app, principal, operation, input) => {
  if (!principal?.ownerId) throw new UnauthorizedError("Unauthorized.");
  const contract = contractFor(operation);
  if (!contract) throw new NotFoundError("Nutrition operation not found.");
  credentials.ensureScopes(principal, [contract.scope]);
  if (!matches(contract.inputSchema, input)) {
    throw new BadRequestError("Input does not match the nutrition operation schema.");
  }
  const estimate = contract.scope === "nutrition:estimate";
  if (estimate) return require("./openai.cjs").predictMacros(app, principal.ownerId, input);
  reserve(app, principal.ownerId);

  const [kind, action] = operation.split(".");
  if (contract.scope === "nutrition:read") return read(app, principal.ownerId, kind, action, input);

  const fingerprint = $security.sha256(JSON.stringify(canonical([operation, input])));
  let result;
  app.runInTransaction((tx) => {
    const owner = principal.ownerId;
    const receipt = first(
      tx,
      collection("operations"),
      "owner = {:owner} && operation_id = {:id}",
      {
        owner,
        id: input.operationId,
      },
    );
    if (receipt) {
      if (receipt.getString("fingerprint") !== fingerprint)
        throw conflict("Operation ID is already in use.");
      result = JSON.parse(receipt.getString("result"));
      return;
    }
    result = mutate(tx, principal, kind, action, input);
    tx.save(
      new Record(tx.findCollectionByNameOrId(collection("operations")), {
        owner,
        operation_id: input.operationId,
        operation,
        actor: principal.credentialRef,
        fingerprint,
        result,
      }),
    );
  });
  return result;
};

module.exports = { execute, readDailyNutrition };
