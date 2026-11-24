const id = { type: "string", pattern: "^[a-zA-Z0-9]{15}$" };
const text = { type: "string" };
const nullableText = { type: ["string", "null"] };
const object = { type: "object" };
const identifiers = { type: "array", items: id };
const metadata = { name: text, objective: text, description: text };
const blockFields = { name: text, objective: text };
const slotFields = { label: text, weekday: { type: "integer", minimum: 1, maximum: 7 } };
const duration = { durationWeeks: { type: "integer", minimum: 1, maximum: 520 } };
const revision = { revision: text };
const confirmation = {
  confirmation: {
    type: "object",
    properties: {
      weekIds: identifiers,
      prescriptionIds: identifiers,
      scheduledSessions: { type: "array", items: object },
    },
    required: ["weekIds", "prescriptionIds", "scheduledSessions"],
  },
};
const prescription = {
  description: text,
  sessionType: text,
  plannedDurationMin: { type: ["integer", "null"], minimum: 0 },
  plannedDurationMax: { type: ["integer", "null"], minimum: 0 },
  plannedRpeMin: { type: ["number", "null"], minimum: 1, maximum: 10 },
  plannedRpeMax: { type: ["number", "null"], minimum: 1, maximum: 10 },
  plannedIntensity: { enum: ["easy", "moderate", "hard", "maximal", null] },
  components: {
    type: "array",
    items: {
      type: "object",
      properties: {
        key: text,
        name: text,
        instructions: text,
        durationMin: { type: ["integer", "null"], minimum: 0 },
        durationMax: { type: ["integer", "null"], minimum: 0 },
        classification: { enum: ["aerobic", "strength", "movement", "mobility", "other", null] },
        optional: { type: "boolean" },
        targets: { type: ["object", "null"] },
        sourceIndex: { type: "integer", minimum: 0 },
      },
      required: ["name"],
    },
  },
};
const copy = { destinationWeekId: id, destinationSlotId: id, slotId: id };
const program = ":programId";
const block = program + "/blocks/:blockId";
const week = block + "/weeks/:weekId";
const slot = block + "/slots/:slotId";
const cell = week + "/cells/:slotId";
const schedule = program + "/schedule/revisions";
const template = ":templateId";
const operations = new Map();

const add = (name, description, method, path, properties = {}, required = [], options = {}) => {
  const pathKeys = path
    .split("/")
    .filter((part) => part.startsWith(":"))
    .map((part) => part.slice(1));
  const inputSchema = {
    type: "object",
    properties: { ...properties, ...Object.fromEntries(pathKeys.map((key) => [key, id])) },
    required: [...pathKeys, ...required],
    additionalProperties: false,
  };
  const readOnly = method === "GET" || options.preview === true;
  const annotations = {
    readOnlyHint: readOnly,
    destructiveHint: !readOnly && (method !== "POST" || options.destructive === true),
    openWorldHint: false,
  };
  operations.set(name, {
    tool: { name, description, annotations, inputSchema },
    method,
    path,
    pathKeys,
    properties,
    readOnly,
    templates: options.templates === true,
  });
};

add(
  "edit_program",
  "Change fields on a draft or active program. Omitted fields keep their current values.",
  "PATCH",
  program,
  metadata,
);
add(
  "get_program_block",
  "Get the weeks, slots and prescription summaries in an owned block.",
  "GET",
  block,
);
add(
  "add_program_block",
  "Add a block to a draft or active program.",
  "POST",
  program + "/blocks",
  { ...blockFields, ...duration, sourceBlockId: id },
  ["name", "durationWeeks"],
);
add("edit_program_block", "Change a block's name or objective.", "PATCH", block, blockFields);
add(
  "reorder_program_blocks",
  "Set the order of all blocks in a program.",
  "POST",
  program + "/reorder",
  { blockIds: identifiers },
  ["blockIds"],
  { destructive: true },
);
add(
  "preview_block_resize",
  "Preview which weeks, prescriptions and calendar entries a resize affects.",
  "POST",
  block + "/resize-preview",
  duration,
  ["durationWeeks"],
  { preview: true },
);
add(
  "resize_program_block",
  "Resize a block. Supply the preview as confirmation when reducing or changing scheduled sessions.",
  "POST",
  block + "/resize",
  { ...duration, ...confirmation },
  ["durationWeeks"],
  { destructive: true },
);
add(
  "duplicate_program_block",
  "Copy a block into a draft or active program.",
  "POST",
  block + "/duplicate",
  { destinationProgramId: id },
  ["destinationProgramId"],
);
add("edit_program_week", "Set a week's label, focus and type.", "PATCH", week, {
  label: text,
  focus: text,
  weekType: { enum: ["normal", "recovery"] },
});
add(
  "add_program_slot",
  "Add a weekly workout slot to a block.",
  "POST",
  block + "/slots",
  slotFields,
  ["label", "weekday"],
);
add("edit_program_slot", "Change a workout slot's weekday or label.", "PATCH", slot, slotFields);
add(
  "move_program_slot",
  "Move a workout slot up or down within the same day.",
  "POST",
  slot + "/move",
  { offset: { enum: [-1, 1] } },
  ["offset"],
  { destructive: true },
);
add(
  "preview_program_slot_removal",
  "Preview the prescriptions and calendar entries affected by removing a slot.",
  "POST",
  slot + "/remove-preview",
  {},
  [],
  { preview: true },
);
add(
  "remove_program_slot",
  "Remove a weekly slot with the confirmation from its removal preview.",
  "POST",
  slot + "/remove",
  confirmation,
  ["confirmation"],
  { destructive: true },
);
add(
  "set_program_slot_template",
  "Assign a library template to a slot baseline, or supply null to clear it.",
  "PATCH",
  slot + "/baseline",
  { templateId: nullableText },
  ["templateId"],
);
add(
  "initialize_program_weeks",
  "Fill empty workout cells from slot baselines. Workouts generated from linked baselines follow library template edits until individually edited.",
  "POST",
  block + "/initialize-weeks",
);
add(
  "get_program_workout",
  "Get a programmed workout and the current revision required for editing it.",
  "GET",
  cell,
);
add(
  "edit_program_workout",
  "Edit a programmed workout directly. Get its current revision first. Omitted fields keep their values. For an empty cell, supply a title and session type. Review pending calendar changes to update scheduled workouts.",
  "PATCH",
  cell,
  { ...prescription, title: text, notes: text, ...revision },
  ["revision"],
);
add(
  "delete_program_workout",
  "Remove a programmed workout with the revision returned by get_program_workout.",
  "DELETE",
  cell,
  revision,
  ["revision"],
);
add(
  "link_program_workout_template",
  "Replace a workout's prescription with a linked Library template while keeping its saved notes. Uses the current cell revision.",
  "PATCH",
  cell + "/template",
  { templateId: id, ...revision },
  ["templateId", "revision"],
);
add(
  "save_program_workout_as_template",
  "Copy a programmed workout into the template library.",
  "POST",
  cell + "/template",
  { name: text, ...revision },
  ["name", "revision"],
);
add(
  "preview_program_workout_copy",
  "Preview copying a full week or a single workout cell.",
  "POST",
  week + "/copy-preview",
  copy,
  ["destinationWeekId"],
  { preview: true },
);
add(
  "copy_program_workouts",
  "Copy prescriptions using the revision from the copy preview.",
  "POST",
  week + "/copy",
  { ...copy, ...revision },
  ["destinationWeekId", "revision"],
  { destructive: true },
);
add(
  "preview_program_calendar_changes",
  "Review pending changes to scheduled workouts and identify protected calendar entries.",
  "POST",
  schedule + "/preview",
  {},
  [],
  { preview: true },
);
add(
  "apply_program_calendar_changes",
  "Apply selected eligible calendar changes using the revision from the calendar preview and a unique UUID operationId.",
  "POST",
  schedule + "/apply",
  { ...revision, operationId: { type: "string", format: "uuid" }, changeIds: identifiers },
  ["revision", "operationId", "changeIds"],
  { destructive: true },
);
add("list_session_templates", "List owned session templates in the library.", "GET", "", {}, [], {
  templates: true,
});
add(
  "get_session_template",
  "Get a library template and its updated timestamp for editing.",
  "GET",
  template,
  {},
  [],
  { templates: true },
);
add(
  "edit_session_template",
  "Edit a library template using its current updated timestamp. Linked baselines and their generated workouts in editable programs inherit changes.",
  "PATCH",
  template,
  { ...prescription, name: text, updated: text },
  ["updated"],
  { templates: true },
);

add(
  "create_session_template",
  "Create a session template in the Library.",
  "POST",
  "",
  { ...prescription, name: text },
  ["name", "sessionType", "components"],
  { templates: true },
);
add(
  "duplicate_session_template",
  "Create an independent copy of a Library template.",
  "POST",
  template + "/duplicate",
  {},
  [],
  { templates: true },
);
add(
  "delete_session_template",
  "Delete a Library template. Baselines and initialized workouts retain their last saved values.",
  "DELETE",
  template,
  {},
  [],
  { templates: true },
);

const run = (event, principal, operation, args) => {
  const path = operation.path.replace(/:([a-zA-Z]+)(?=\/|$)/g, (_, key) => {
    if (typeof args[key] !== "string" || !/^[a-zA-Z0-9]{15}$/.test(args[key])) {
      throw new BadRequestError(`Provide a valid ${key}.`);
    }
    return args[key];
  });
  const body = Object.fromEntries(
    Object.keys(operation.properties)
      .filter((key) => !operation.pathKeys.includes(key) && args[key] !== undefined)
      .map((key) => [key, args[key]]),
  );
  const handler = require(__hooks + (operation.templates ? "/templates.js" : "/programs.js"));
  return handler({
    app: event.app,
    auth: { id: principal.ownerId },
    request: { method: operation.method, pathValue: () => path },
    requestInfo: () => ({ body }),
    json: (status, value) => ({ status, value }),
  });
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { operations, run };
