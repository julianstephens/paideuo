/* oxlint-disable import/no-commonjs */

const { contractFor, matches, maxTargetDays } = require("./nutrition-contracts.cjs");
const { targetSource, resolveTargets, summarize, canonical } = require("./nutrition-domain.cjs");
const dates = require("./calendar-dates.js");
const credentials = require("./service-credentials.cjs");

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
  if (source.kind === "inline") return { source: { kind: "inline" }, snapshot: source.food };
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

const create = (db, principal, kind, input) => {
  const owner = principal.ownerId;
  const name = collection(kind);
  const parent = parentSpecs[kind];
  const fields = { owner, external_id: input.externalId };
  let data = kind === "foods" ? foodData(input.data) : input.data;

  if (first(db, name, "owner = {:owner} && external_id = {:id}", { owner, id: input.externalId })) {
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

const mutate = (db, principal, kind, action, input) => {
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
  const parent = parentSpecs[kind];
  if (parent && input[parent.key]) {
    params.parent = input[parent.key];
    owned(db, parent.name, owner, params.parent);
    filters.push(parent.field + " = {:parent}");
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

const dailyEntries = (db, kind, owner, date) =>
  find(db, collection(kind), "owner = {:owner} && date = {:date}", { owner, date })
    .map(dataOf)
    .filter((data) => !data.deleted && !data.canceled);

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
  if (action === "get") return resultOf(entryRecord(db, kind, owner, input.id));
  if (action === "list") return list(db, kind, owner, input);
  if (action === "for_entry") return recipeForEntry(db, owner, input);
  if (action === "resolve_bulk") return resolveBulk(db, owner, input);
  const date = civilDate(input.date);
  const target = effective(targetContext(db, owner, input.programId), date);
  if (action === "resolve") return target;
  return {
    date: input.date,
    target,
    planned: summarize(dailyEntries(db, "planned", owner, input.date)),
    consumed: summarize(dailyEntries(db, "consumed", owner, input.date)),
  };
};

const execute = (app, principal, operation, input) => {
  if (!principal?.ownerId) throw new UnauthorizedError("Unauthorized.");
  const contract = contractFor(operation);
  if (!contract) throw new NotFoundError("Nutrition operation not found.");
  credentials.ensureScopes(principal, [contract.scope]);
  if (!matches(contract.inputSchema, input)) {
    throw new BadRequestError("Input does not match the nutrition operation schema.");
  }
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
        fingerprint,
        result,
      }),
    );
  });
  return result;
};

module.exports = { execute };
