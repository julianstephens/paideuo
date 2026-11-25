/* oxlint-disable import/no-commonjs */

const macroKeys = ["calories", "protein", "carbohydrate", "fat"];
const object = (properties, required = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const text = (maxLength, minLength = 1) => ({ type: "string", minLength, maxLength });
const id = { type: "string", pattern: "^[a-z0-9]{15}$" };
const externalId = text(200);
const notes = text(4000, 0);
const date = { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" };
const decimal = (maximum) => ({ type: "number", minimum: 0, maximum, multipleOf: 0.001 });
const quantity = decimal(1000);
const macro = decimal(1000000);
const nullable = (schema) => ({ anyOf: [schema, { type: "null" }] });
const macros = (schema) => object(Object.fromEntries(macroKeys.map((key) => [key, schema])));
const estimates = macros(macro);
const overrides = macros(nullable(macro));
const boolean = { type: "boolean" };
const enumOf = (...values) => ({ type: "string", enum: values });
const serving = object({ description: text(200), size: quantity, unit: text(100) }, [
  "description",
  "size",
  "unit",
]);
const foodFields = { title: text(200), serving, macros: estimates };
const foodSnapshot = object(foodFields, ["title", "serving", "macros"]);
const food = object(
  {
    ...foodFields,
    description: notes,
    category: text(100, 0),
    notes,
    archived: boolean,
  },
  ["title", "serving", "macros"],
);
const ingredient = object({ name: text(200), quantity, unit: text(100), prep: text(500, 0) }, [
  "name",
]);
const recipe = object(
  {
    ingredients: { type: "array", items: ingredient, maxItems: 100 },
    instructions: notes,
    portions: quantity,
  },
  ["ingredients"],
);
const measuredIngredient = object(ingredient.properties, ["name", "quantity", "unit"]);
const unmeasuredIngredient = object(
  { name: ingredient.properties.name, prep: ingredient.properties.prep },
  ["name"],
);
const recipeInput = object(
  {
    ...recipe.properties,
    ingredients: {
      ...recipe.properties.ingredients,
      items: { anyOf: [measuredIngredient, unmeasuredIngredient] },
    },
  },
  ["ingredients"],
);
const targetFields = { active: boolean, macros: overrides };
const plan = object(targetFields);
const selector = {
  anyOf: [
    object({ kind: enumOf("block"), blockId: id }, ["kind", "blockId"]),
    object({ kind: enumOf("week"), weekId: id }, ["kind", "weekId"]),
    object(
      {
        kind: enumOf("weekday"),
        weekId: id,
        weekday: { type: "integer", minimum: 1, maximum: 7 },
      },
      ["kind", "weekId", "weekday"],
    ),
    object({ kind: enumOf("date"), date }, ["kind", "date"]),
  ],
};
const target = object({ ...targetFields, selector }, ["selector"]);
const plannedSource = {
  anyOf: [
    object({ kind: enumOf("bank"), foodId: id }, ["kind", "foodId"]),
    object({ kind: enumOf("inline"), food: foodSnapshot }, ["kind", "food"]),
  ],
};
const consumedSource = {
  anyOf: [...plannedSource.anyOf, object({ kind: enumOf("planned") }, ["kind"])],
};
const entryFields = {
  date,
  timezone: text(100),
  quantity,
  programId: id,
  meal: text(100),
  notes,
  overrides,
};
const order = { type: "integer", minimum: 0, maximum: 1000000 };
const consumedAt = text(40);
const planned = object({ ...entryFields, source: plannedSource, order }, [
  "date",
  "quantity",
  "source",
]);
const consumed = object(
  {
    ...entryFields,
    source: consumedSource,
    plannedId: id,
    consumedAt,
  },
  ["quantity", "source"],
);
const entryEdit = {
  quantity,
  meal: nullable(text(100)),
  notes,
  overrides,
  date,
};
const plannedEdit = object({ ...entryEdit, order, canceled: boolean });
const consumedEdit = object({ ...entryEdit, consumedAt: nullable(consumedAt) });

const entity = (data) => object({ id, externalId, data }, ["id", "externalId", "data"]);
const storedSource = {
  anyOf: [
    object({ kind: enumOf("bank"), foodId: id }, ["kind", "foodId"]),
    object({ kind: enumOf("inline") }, ["kind"]),
    object({ kind: enumOf("planned") }, ["kind"]),
  ],
};
const storedEntry = {
  ...entryFields,
  source: storedSource,
  snapshot: foodSnapshot,
  deleted: boolean,
  createdBy: text(200),
  updatedBy: text(200),
};
const storedPlanned = object({ ...storedEntry, order, canceled: boolean }, [
  "date",
  "timezone",
  "quantity",
  "source",
  "snapshot",
  "createdBy",
  "updatedBy",
]);
const storedConsumed = object({ ...storedEntry, plannedId: id, consumedAt }, [
  "date",
  "timezone",
  "quantity",
  "source",
  "snapshot",
  "createdBy",
  "updatedBy",
]);
const resultSchemas = {
  foods: entity(food),
  recipes: entity(object({ ...recipe.properties, foodId: id }, ["ingredients", "foodId"])),
  plans: entity(object({ ...plan.properties, programId: id }, ["programId"])),
  targets: entity(object({ ...target.properties, planId: id }, ["selector", "planId"])),
  planned: entity(storedPlanned),
  consumed: entity(storedConsumed),
};

const source = object(
  {
    kind: enumOf("program", "block", "week", "weekday", "date"),
    id,
  },
  ["kind", "id"],
);
const effectiveTarget = object(
  {
    value: nullable(macro),
    source: nullable(source),
  },
  ["value", "source"],
);
const targets = object(
  {
    active: boolean,
    activationSource: nullable(source),
    macros: nullable(macros(effectiveTarget)),
  },
  ["active", "activationSource", "macros"],
);
const count = { type: "integer", minimum: 0 };
const total = object(
  {
    subtotal: nullable({ type: "number", minimum: 0 }),
    knownCount: count,
  },
  ["subtotal", "knownCount"],
);
const totals = object({ entryCount: count, macros: macros(total) }, ["entryCount", "macros"]);

const operations = {};
const define = (name, scope, inputSchema, outputSchema) => {
  operations[name] = { scope: "nutrition:" + scope, inputSchema, outputSchema };
};
for (const [entityName, create, edit, parent, deletable] of [
  ["foods", food, food],
  ["recipes", recipeInput, recipeInput, "foodId", true],
  ["plans", plan, plan, "programId", true],
  ["targets", target, plan, "planId", true],
  ["planned", planned, plannedEdit, undefined, true],
  ["consumed", consumed, consumedEdit, undefined, true],
]) {
  const result = resultSchemas[entityName];
  const identity = object({ id }, ["id"]);
  const pagination = { after: id, limit: { type: "integer", minimum: 1, maximum: 100 } };
  const children = parent ? { [parent]: id } : {};
  const filters =
    entityName === "foods"
      ? {
          includeArchived: boolean,
          status: enumOf("active", "archived", "all"),
          search: text(200, 0),
          category: text(100, 0),
        }
      : {};
  const dated = entityName === "planned" || entityName === "consumed";
  if (entityName === "consumed") filters.plannedId = id;
  const listFields = { ...pagination, ...children, ...filters };
  const listSchema = dated
    ? {
        type: "object",
        anyOf: [
          object({ ...listFields, date }),
          object({ ...listFields, startDate: date, endDate: date }, ["startDate", "endDate"]),
        ],
      }
    : object(listFields);
  define(entityName + ".get", "read", identity, result);
  define(
    entityName + ".list",
    "read",
    listSchema,
    object({ items: { type: "array", items: result }, next: nullable(id) }, ["items", "next"]),
  );
  define(
    entityName + ".create",
    "write",
    object(
      {
        operationId: externalId,
        externalId,
        data: create,
        ...children,
      },
      ["operationId", "externalId", "data", ...(parent ? [parent] : [])],
    ),
    result,
  );
  define(
    entityName + ".update",
    "write",
    object({ operationId: externalId, id, data: edit }, ["operationId", "id", "data"]),
    result,
  );
  if (deletable) {
    define(
      entityName + ".delete",
      "write",
      object({ operationId: externalId, id }, ["operationId", "id"]),
      object({ id }, ["id"]),
    );
  }
}
define(
  "foods.duplicate",
  "write",
  object(
    {
      id,
      externalId,
      operationId: externalId,
      title: text(200),
    },
    ["id", "externalId", "operationId", "title"],
  ),
  resultSchemas.foods,
);
define(
  "foods.set_archive",
  "write",
  object(
    {
      id,
      operationId: externalId,
      archived: boolean,
    },
    ["id", "operationId", "archived"],
  ),
  resultSchemas.foods,
);

define(
  "recipes.for_entry",
  "read",
  object({ entryKind: enumOf("planned", "consumed"), entryId: id }, ["entryKind", "entryId"]),
  object({ recipe: nullable(resultSchemas.recipes) }, ["recipe"]),
);

const maxTargetDays = 62;
const maxPlannedBatch = 100;
const array = (items, maxItems, minItems = 0) => ({
  type: "array",
  items,
  ...(maxItems === undefined ? {} : { maxItems }),
  minItems,
});
const plannedBatch = {
  anyOf: [
    object(
      {
        kind: enumOf("schedule"),
        entries: array(
          object({ externalId, data: planned }, ["externalId", "data"]),
          maxPlannedBatch,
          1,
        ),
      },
      ["kind", "entries"],
    ),
    object({ kind: enumOf("copy"), id, destinationDate: date }, ["kind", "id", "destinationDate"]),
    object({ kind: enumOf("clone"), startDate: date, endDate: date, destinationDate: date }, [
      "kind",
      "startDate",
      "endDate",
      "destinationDate",
    ]),
  ],
};
const previewToken = { type: "string", pattern: "^[0-9a-f]{64}$" };
const plannedItems = array(resultSchemas.planned, Number.MAX_SAFE_INTEGER);
const proposal = object({ externalId, data: storedPlanned }, ["externalId", "data"]);
define(
  "planned.week",
  "read",
  object({ startDate: date, programId: id }, ["startDate"]),
  object(
    {
      days: array(
        object(
          {
            date,
            entries: plannedItems,
            planned: totals,
            target: targets,
            remaining: macros(nullable({ type: "number" })),
          },
          ["date", "entries", "planned", "target", "remaining"],
        ),
        7,
        7,
      ),
    },
    ["days"],
  ),
);
define(
  "planned.preview",
  "read",
  plannedBatch,
  object(
    {
      previewToken,
      additions: array(proposal, maxPlannedBatch),
      destinations: array(
        object({ date, entries: plannedItems }, ["date", "entries"]),
        maxPlannedBatch,
      ),
    },
    ["previewToken", "additions", "destinations"],
  ),
);
define(
  "planned.commit",
  "write",
  object({ operationId: externalId, previewToken, batch: plannedBatch }, [
    "operationId",
    "previewToken",
    "batch",
  ]),
  object({ items: array(object({ id, externalId }, ["id", "externalId"]), maxPlannedBatch) }, [
    "items",
  ]),
);
const maxConsumedBatch = 100;
define(
  "consumed.batch_create",
  "write",
  object(
    {
      operationId: externalId,
      entries: array(
        object({ externalId, data: consumed }, ["externalId", "data"]),
        maxConsumedBatch,
        1,
      ),
    },
    ["operationId", "entries"],
  ),
  object({ items: array(object({ id, externalId }, ["id", "externalId"]), maxConsumedBatch) }, [
    "items",
  ]),
);
for (const [kind, parent, data] of [
  ["plans", "programId", plan],
  ["targets", "planId", target],
]) {
  define(
    kind + ".upsert",
    "write",
    object({ operationId: externalId, externalId, [parent]: id, data }, [
      "operationId",
      parent,
      "data",
    ]),
    resultSchemas[kind],
  );
}

const categoryResult = object(
  { categories: array(text(100), 50), previousCategories: array(text(100)) },
  ["categories", "previousCategories"],
);
define("categories.list", "read", object({}), categoryResult);
for (const [action, fields] of [
  ["add", { newName: text(100) }],
  ["rename", { name: text(100), newName: text(100) }],
  ["remove", { name: text(100) }],
]) {
  define(
    "categories." + action,
    "write",
    object({ operationId: externalId, ...fields }, ["operationId", ...Object.keys(fields)]),
    categoryResult,
  );
}

const predictionFields = {
  title: text(200),
  category: text(100),
  servingDescription: text(200),
  servingUnit: text(100),
  servingSize: { ...quantity, minimum: 0.001 },
};
define(
  "foods.predict-macros",
  "estimate",
  object({ ...predictionFields, description: notes }, Object.keys(predictionFields)),
  object({ macros: { ...estimates, required: macroKeys } }, ["macros"]),
);

const publishedDescriptions = {
  "plans.upsert": "Create or replace the default nutrition target layer for an owned program.",
  "targets.upsert": "Create or replace a target layer for an owned plan and selector.",
  "categories.list": "List food categories and previously used labels.",
  "categories.add": "Add an owned food category.",
  "categories.rename": "Rename an owned category and its food assignments.",
  "categories.remove":
    "Remove a category from new selections while preserving existing assignments.",
  "foods.predict-macros":
    "Estimate macros for one serving using the owner's configured OpenAI key. This may incur a provider charge and returns editable values.",
  "consumed.get": "Get an owned consumed-food entry.",
  "consumed.list": "List owned consumed-food entries by civil date or linked planned entry.",
  "consumed.create":
    "Log a bank food, one-off, or portion linked to planned food. Macro overrides are totals for the entire entry.",
  "consumed.update": "Correct an eaten entry. Macro overrides are totals for the entire entry.",
  "consumed.delete": "Remove an eaten entry from the daily log.",
  "consumed.batch_create":
    "Atomically log up to 100 eaten entries, including planned portions and substitutions.",
  "days.summary": "Compare daily planned and eaten totals with optional program targets.",
  "days.summary_range": "Compare planned and eaten totals across up to 62 civil dates.",
  "planned.get": "Get an owned planned-food entry.",
  "planned.list": "List owned planned-food entries, optionally by civil date.",
  "planned.create": "Schedule a bank food or one-off food.",
  "planned.update": "Edit, move, reorder, cancel, or restore an owned planned-food entry.",
  "planned.delete": "Remove an owned planned-food entry from the schedule.",
  "planned.week": "Show seven days of scheduled food, estimated totals, and optional targets.",
  "planned.preview":
    "Preview scheduling or copying planned food, with existing destination entries.",
  "planned.commit": "Append a reviewed batch of planned food atomically.",
  "plans.list": "List owned nutrition plans, optionally for a specific program.",
  "plans.get": "Get an owned program nutrition plan.",
  "plans.create": "Create a nutrition plan for an owned program.",
  "plans.update": "Replace a program's default nutrition target layer.",
  "plans.delete": "Remove a program nutrition plan and its overrides.",
  "targets.list": "List owned target overrides, optionally for a specific plan.",
  "targets.get": "Get an owned nutrition target override.",
  "targets.create": "Create a block, week, weekday, or exact-date target override.",
  "targets.update": "Replace an owned target override's activation and macros.",
  "targets.delete": "Remove an owned target override.",
  "targets.resolve": "Resolve a program's nutrition targets on a civil date.",
  "targets.resolve_bulk":
    "Resolve daily nutrition targets for an inclusive range of up to 62 days.",
  "foods.list": "List owned foods with search, category, status, and pagination filters.",
  "foods.get": "Get an owned food by ID, including archived foods.",
  "foods.create": "Create a food with manual per-serving macro estimates.",
  "foods.update": "Edit an owned food and its per-serving estimates.",
  "foods.duplicate": "Copy an owned food into a new active item without its recipe.",
  "foods.set_archive": "Archive or restore an owned food.",
  "recipes.list": "List owned recipes, optionally for a specific food.",
  "recipes.get": "Get an owned recipe by ID.",
  "recipes.create": "Attach an ordered recipe to an owned food.",
  "recipes.update": "Replace the ingredients, instructions, and portions of an owned recipe.",
  "recipes.delete": "Remove a recipe attachment from an owned food.",
  "recipes.for_entry":
    "Get the current recipe associated with an owned planned or consumed food entry.",
};

define("targets.resolve", "read", object({ date, programId: id }, ["date", "programId"]), targets);
define(
  "targets.resolve_bulk",
  "read",
  object({ programId: id, startDate: date, endDate: date }, ["programId", "startDate", "endDate"]),
  object(
    {
      days: {
        type: "array",
        items: object({ date, target: targets }, ["date", "target"]),
        maxItems: maxTargetDays,
      },
    },
    ["days"],
  ),
);
const daySummary = object({ date, target: targets, planned: totals, consumed: totals }, [
  "date",
  "target",
  "planned",
  "consumed",
]);
define("days.summary", "read", object({ date, programId: id }, ["date"]), daySummary);
define(
  "days.summary_range",
  "read",
  object({ startDate: date, endDate: date, programId: id }, ["startDate", "endDate"]),
  object({ days: array(daySummary, maxTargetDays) }, ["days"]),
);

const metricValue = nullable({ type: "number" });
const metricMeasureFields = { total: metricValue, average: metricValue, days: count };
const metricMeasure = object(metricMeasureFields, Object.keys(metricMeasureFields));
const partialMeasure = object({ ...metricMeasureFields, partialDays: count }, [
  ...Object.keys(metricMeasureFields),
  "partialDays",
]);
const macroMetric = object(
  {
    planned: partialMeasure,
    consumed: partialMeasure,
    target: metricMeasure,
    attainment: object({ ratio: metricValue, days: count }, ["ratio", "days"]),
    planDifference: metricMeasure,
  },
  ["planned", "consumed", "target", "attainment", "planDifference"],
);
const foodNutrition = object(
  {
    days: count,
    loggedDays: count,
    plannedDays: count,
    activePlanDays: count,
    macros: {
      ...macros(macroMetric),
      required: macroKeys,
    },
  },
  ["days", "loggedDays", "plannedDays", "activePlanDays", "macros"],
);
const metricsPeriod = {
  ...object({ foodNutrition: nullable(foodNutrition) }),
  additionalProperties: true,
};
const metricsOutput = {
  ...object(
    {
      total: metricsPeriod,
      periods: array(metricsPeriod),
      nutritionDays: array(
        object({ ...daySummary.properties, foodNutrition }, [
          ...daySummary.required,
          "foodNutrition",
        ]),
      ),
    },
    ["total", "periods"],
  ),
  additionalProperties: true,
};

const matches = (schema, value) => {
  if (schema.anyOf) return schema.anyOf.some((alternative) => matches(alternative, value));
  if (schema.enum && !schema.enum.includes(value)) return false;
  switch (schema.type) {
    case "object":
      return (
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        (schema.required ?? []).every((key) => Object.hasOwn(value, key)) &&
        Object.keys(value).every((key) =>
          Object.hasOwn(schema.properties, key)
            ? matches(schema.properties[key], value[key])
            : schema.additionalProperties === true,
        )
      );
    case "array":
      return (
        Array.isArray(value) &&
        value.length >= (schema.minItems ?? 0) &&
        value.length <= (schema.maxItems ?? Infinity) &&
        value.every((item) => matches(schema.items, item))
      );
    case "string":
      return (
        typeof value === "string" &&
        value.length >= (schema.minLength ?? 0) &&
        value.length <= (schema.maxLength ?? Infinity) &&
        (!schema.pattern || new RegExp(schema.pattern).test(value))
      );
    case "number":
    case "integer": {
      if (
        !Number.isFinite(value) ||
        value < (schema.minimum ?? -Infinity) ||
        value > (schema.maximum ?? Infinity)
      )
        return false;
      if (schema.type === "integer") return Number.isSafeInteger(value);
      if (!schema.multipleOf) return true;
      const rounded = Math.round(value * 1000);
      return value === rounded / 1000;
    }
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    default:
      return false;
  }
};

const contractFor = (name) => (Object.hasOwn(operations, name) ? operations[name] : undefined);
const restContract = (name) => {
  const contract = contractFor(name);
  return (
    contract && {
      method: "POST",
      path: "/api/paideuo/v1/nutrition/" + name.replace(".", "/"),
      ...contract,
    }
  );
};
const mcpContract = (name) => {
  const contract = contractFor(name);
  return (
    contract && {
      name: "nutrition_" + name.replace(/[.-]/g, "_"),
      ...(publishedDescriptions[name] ? { description: publishedDescriptions[name] } : {}),
      annotations: {
        readOnlyHint: contract.scope === "nutrition:read",
        ...(contract.scope === "nutrition:estimate" && {
          openWorldHint: true,
          destructiveHint: false,
        }),
      },
      inputSchema: contract.inputSchema,
      outputSchema: contract.outputSchema,
    }
  );
};

const publishedToolScopes = new Map(
  Object.keys(publishedDescriptions).map((operation) => [
    mcpContract(operation).name,
    operations[operation].scope,
  ]),
);
module.exports = {
  macroKeys,
  metricsOutput,
  maxTargetDays,
  maxPlannedBatch,
  matches,
  operations,
  contractFor,
  restContract,
  mcpContract,
  publishedToolScopes,
  publishedOperations: Object.keys(publishedDescriptions),
};
