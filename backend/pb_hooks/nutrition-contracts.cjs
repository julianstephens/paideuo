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
  ["recipes", recipe, recipe, "foodId", true],
  ["plans", plan, plan, "programId"],
  ["targets", target, plan, "planId", true],
  ["planned", planned, plannedEdit, undefined, true],
  ["consumed", consumed, consumedEdit, undefined, true],
]) {
  const result = resultSchemas[entityName];
  const identity = object({ id }, ["id"]);
  const pagination = { after: id, limit: { type: "integer", minimum: 1, maximum: 100 } };
  const children = parent ? { [parent]: id } : {};
  const filters = entityName === "foods" ? { includeArchived: boolean } : {};
  if (entityName === "planned" || entityName === "consumed") filters.date = date;
  define(entityName + ".get", "read", identity, result);
  define(
    entityName + ".list",
    "read",
    object({ ...pagination, ...children, ...filters }),
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
define("targets.resolve", "read", object({ date, programId: id }, ["date", "programId"]), targets);
define(
  "days.summary",
  "read",
  object({ date, programId: id }, ["date"]),
  object(
    {
      date,
      target: targets,
      planned: totals,
      consumed: totals,
    },
    ["date", "target", "planned", "consumed"],
  ),
);

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
        Object.keys(value).every(
          (key) =>
            Object.hasOwn(schema.properties, key) && matches(schema.properties[key], value[key]),
        )
      );
    case "array":
      return (
        Array.isArray(value) &&
        value.length <= schema.maxItems &&
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
      name: "nutrition_" + name.replace(".", "_"),
      annotations: { readOnlyHint: contract.scope === "nutrition:read" },
      inputSchema: contract.inputSchema,
      outputSchema: contract.outputSchema,
    }
  );
};

module.exports = { macroKeys, matches, operations, contractFor, restContract, mcpContract };
