/* oxlint-disable import/no-commonjs */
const credentials = require(__hooks + "/service-credentials.cjs");
const imports = require(__hooks + "/imports.js");

const tools = [
  {
    name: "list_programs",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "List programs owned by the authenticated principal.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_program",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Get an owned program with blocks, weeks, slots, prescriptions, and components.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, externalId: { type: "string" } },
      additionalProperties: false,
      anyOf: [{ required: ["id"] }, { required: ["externalId"] }],
    },
  },
  {
    name: "create_draft",
    annotations: { destructiveHint: false, openWorldHint: false },
    description: "Create a new draft program. Use commit_import to modify an existing program.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: 200 },
        externalId: { type: "string", maxLength: 200 },
        description: { type: "string", maxLength: 10000 },
        objective: { type: "string", maxLength: 10000 },
        operationId: { type: "string", maxLength: 200 },
      },
      required: ["name", "externalId"],
      additionalProperties: false,
    },
  },
  {
    name: "preview_import",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Validate and preview an import without writing or consuming a preview.",
    inputSchema: {
      type: "object",
      properties: { document: { type: "object" } },
      required: ["document"],
      additionalProperties: false,
    },
  },
  {
    name: "commit_import",
    annotations: { destructiveHint: true, openWorldHint: false },
    description:
      "Commit an exact previewed import. Scheduled/completed plan changes require explicit approval.",
    inputSchema: {
      type: "object",
      properties: {
        previewToken: { type: "string" },
        document: { type: "object" },
        approvalReceipt: {
          type: "string",
          description: "Receipt issued by the owner approval endpoint for this preview.",
        },
        operationId: { type: "string", maxLength: 200 },
      },
      required: ["previewToken", "document"],
      additionalProperties: false,
    },
  },
  {
    name: "record_workout",
    annotations: { destructiveHint: true, openWorldHint: false },
    description: "Record workout results through the validated batch ingestion service.",
    inputSchema: {
      type: "object",
      properties: {
        data: { type: "object" },
        operationId: { type: "string", maxLength: 200 },
        replaceExistingCompletion: { type: "boolean" },
      },
      required: ["data"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_check_ins",
    annotations: { destructiveHint: true, openWorldHint: false },
    description: "Submit check-in observations through the validated batch ingestion service.",
    inputSchema: {
      type: "object",
      properties: {
        entries: { type: "array", items: { type: "object" } },
        operationId: { type: "string", maxLength: 200 },
      },
      required: ["entries"],
      additionalProperties: false,
    },
  },
  {
    name: "fetch_metrics",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Fetch metrics for an owned program or custom date window.",
    inputSchema: {
      type: "object",
      properties: {
        view: { enum: ["weekly", "block", "program", "custom"] },
        program: { type: "string" },
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
      },
      required: ["view"],
      additionalProperties: false,
    },
  },
  {
    name: "list_workouts",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "List scheduled workouts (both one-off and program-based) for a date range.",
    inputSchema: {
      type: "object",
      properties: {
        start: { type: "string", format: "date" },
        end: { type: "string", format: "date" },
      },
      required: ["start", "end"],
      additionalProperties: false,
    },
  },
  {
    name: "get_workout",
    annotations: { readOnlyHint: true, openWorldHint: false },
    description: "Get details of a specific scheduled workout.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "create_one_off_workout",
    annotations: { destructiveHint: true, openWorldHint: false },
    description: "Create a one-off workout for a specific date.",
    inputSchema: {
      type: "object",
      properties: {
        scheduledDate: { type: "string", format: "date" },
        timezone: { type: "string", maxLength: 100 },
        prescription: { type: "object" },
        operationId: { type: "string", maxLength: 36 },
      },
      required: ["scheduledDate", "timezone", "prescription", "operationId"],
      additionalProperties: false,
    },
  },
  {
    name: "edit_one_off_workout",
    annotations: { destructiveHint: true, openWorldHint: false },
    description: "Edit an existing one-off workout prescription or scheduled date.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        prescription: { type: "object" },
        scheduledDate: { type: "string", format: "date" },
      },
      additionalProperties: false,
      anyOf: [{ required: ["id", "prescription"] }, { required: ["id", "scheduledDate"] }],
    },
  },
  {
    name: "delete_one_off_workout",
    annotations: { destructiveHint: true, openWorldHint: false },
    description: "Delete a one-off workout.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

const rpcError = (status, message) => {
  const error = new Error(message);
  error.status = status;
  error.rpcCode =
    status === 401
      ? -32001
      : status === 403
        ? -32003
        : status === 409
          ? -32009
          : status === -32601
            ? -32601
            : status === -32602
              ? -32602
              : status === -32600
                ? -32600
                : -32000;
  return error;
};

const principalForEvent = (event) => {
  if (event.auth?.id) return credentials.importPrincipalFromEvent(event);
  return credentials.servicePrincipalFromEvent(event);
};

const requireScope = (principal, scope) => {
  if (principal.type === "user") return;
  if (!principal.scopes.has(scope)) throw rpcError(403, `Missing required scope: ${scope}.`);
};

const cloneBodyEvent = (event, body) => ({
  app: event.app,
  auth: event.auth,
  requestInfo: () => ({ body }),
  request: event.request,
  json: (status, value) => ({ status, value }),
});

const find = (db, collection, filter, params, sort = "") =>
  db.findRecordsByFilter(collection, filter, sort, 0, 0, params);

const listPrograms = (event, principal) => {
  requireScope(principal, "programs:read");
  return find(
    event.app,
    "paideuo_programs",
    "owner = {:owner}",
    { owner: principal.ownerId },
    "-updated",
  ).map((record) => ({
    id: record.id,
    externalId: record.getString("external_id"),
    name: record.getString("name"),
    status: record.getString("status"),
  }));
};

const getProgram = (event, principal, args) => {
  requireScope(principal, "programs:read");
  if (!args.id && !args.externalId)
    throw new BadRequestError("Provide a program id or externalId.");
  const filter = args.id
    ? "id = {:id} && owner = {:owner}"
    : "external_id = {:externalId} && owner = {:owner}";
  const params = args.id
    ? { id: args.id, owner: principal.ownerId }
    : { externalId: args.externalId, owner: principal.ownerId };
  let result;
  event.app.runInTransaction((tx) => {
    const record = find(tx, "paideuo_programs", filter, params)[0];
    if (!record) throw new NotFoundError("Program not found.");
    const parents = { program: record.id };
    const schedule = find(tx, "paideuo_program_schedules", "program = {:program}", parents)[0];
    const groupByParent = (collection, filter, relation) => {
      const groups = new Map();
      for (const row of find(tx, collection, filter, parents, "position,id")) {
        const parent = row.getString(relation);
        if (!groups.has(parent)) groups.set(parent, []);
        groups.get(parent).push(row);
      }
      return groups;
    };
    const slots = groupByParent("paideuo_session_slots", "block.program = {:program}", "block");
    const weeks = groupByParent("paideuo_program_weeks", "block.program = {:program}", "block");
    const prescriptions = new Map();
    for (const row of find(
      tx,
      "paideuo_session_prescriptions",
      "program_week.block.program = {:program}",
      parents,
      "id",
    )) {
      const week = row.getString("program_week");
      if (!prescriptions.has(week)) prescriptions.set(week, []);
      prescriptions.get(week).push(row);
    }
    const components = groupByParent(
      "paideuo_training_components",
      "prescription.program_week.block.program = {:program}",
      "prescription",
    );
    const identity = (row) => ({ id: row.id, externalId: row.getString("external_id") });
    const duration = (row, field) =>
      row.getBool("duration_specified") || row.getInt(field) > 0 ? row.getInt(field) : null;
    result = {
      ...identity(record),
      name: record.getString("name"),
      objective: record.getString("objective"),
      description: record.getString("description"),
      status: record.getString("status"),
      scheduled: Boolean(schedule),
      blocks: find(tx, "paideuo_blocks", "program = {:program}", parents, "position,id").map(
        (block) => ({
          ...identity(block),
          name: block.getString("name"),
          objective: block.getString("objective"),
          position: block.getInt("position"),
          durationWeeks: block.getInt("duration_weeks"),
          slots: (slots.get(block.id) ?? []).map((slot) => ({
            ...identity(slot),
            position: slot.getInt("position"),
            weekday: slot.getInt("weekday"),
            label: slot.getString("label"),
            baseline: JSON.parse(slot.getString("baseline") || "null"),
          })),
          weeks: (weeks.get(block.id) ?? []).map((week) => ({
            ...identity(week),
            position: week.getInt("position"),
            label: week.getString("label"),
            focus: week.getString("focus"),
            weekType: week.getString("week_type"),
            prescriptions: (prescriptions.get(week.id) ?? []).map((prescription) => ({
              ...identity(prescription),
              slotId: prescription.getString("slot"),
              workout: {
                title: prescription.getString("title"),
                description: prescription.getString("description"),
                sessionType: prescription.getString("session_type"),
                notes: prescription.getString("notes"),
                plannedDurationMin: duration(prescription, "planned_duration_min"),
                plannedIntensity: prescription.getString("planned_intensity") || null,
                components: (components.get(prescription.id) ?? []).map((component) => ({
                  id: component.id,
                  position: component.getInt("position"),
                  name: component.getString("name"),
                  instructions: component.getString("instructions"),
                  durationMin: duration(component, "duration_min"),
                  targets: JSON.parse(component.getString("targets") || "null"),
                })),
              },
            })),
          })),
        }),
      ),
    };
  });
  return result;
};

const requireImportScopes = (principal, kind) => {
  for (const scope of credentials.requiredScopesForImportKind(kind)) requireScope(principal, scope);
};

const serviceResult = ({ status, value }) => {
  if (status >= 400) {
    const error = rpcError(status, value.message ?? "The operation failed.");
    error.details = value;
    throw error;
  }
  return value;
};

const makeDraftDocument = (args) => ({
  schema: "paideuo",
  version: 1,
  kind: "program",
  data: {
    program: {
      externalId: args.externalId,
      name: args.name,
      description: args.description ?? "",
      objective: args.objective ?? "",
      status: "draft",
    },
    blocks: [],
  },
});


const presentWorkout = (row) => {
  const snapshot = JSON.parse(row.getString("prescription_snapshot") || "{}");
  return {
    id: row.id,
    scheduledDate: row.getString("scheduled_date"),
    timezone: row.getString("timezone"),
    status: row.getString("status"),
    prescription: {
      title: snapshot.title || "",
      sessionType: snapshot.sessionType || "other",
      description: snapshot.description || "",
      notes: snapshot.notes || "",
      plannedDurationMin: snapshot.plannedDurationMin,
      plannedDurationMax: snapshot.plannedDurationMax,
      plannedRpeMin: snapshot.plannedRpeMin,
      plannedRpeMax: snapshot.plannedRpeMax,
      plannedIntensity: snapshot.plannedIntensity,
      kind: snapshot.kind,
      rest: snapshot.rest || false,
      components: snapshot.components || [],
    },
  };
};

const listWorkouts = (event, principal, args) => {
  requireScope(principal, "workouts:read");
  const dates = require(__hooks + "/calendar-dates.js");
  const first = dates.parse(args.start);
  const last = dates.parse(args.end);
  if (!first || !last || last < first || last.getTime() - first.getTime() > 41 * 86400000) {
    throw rpcError(400, "Provide a valid date range of up to 42 days.");
  }
  const { ownerFilter } = require(__hooks + "/calendar-sessions.js");
  let workouts = [];
  event.app.runInTransaction((tx) => {
    const records = find(
      tx,
      "paideuo_scheduled_sessions",
      ownerFilter() +
        " && deleted = false && scheduled_date >= {:start} && scheduled_date <= {:end}",
      { owner: principal.ownerId, start: args.start, end: args.end },
      "scheduled_date,slot_position,schedule,id",
    );
    tx.expandRecords(records, ["schedule"], null);
    workouts = records.map(presentWorkout);
  });
  return workouts;
};

const getWorkout = (event, principal, args) => {
  requireScope(principal, "workouts:read");
  if (!args.id) throw rpcError(-32602, "Provide a workout id.");
  let workout = null;
  event.app.runInTransaction((tx) => {
    const record = find(
      tx,
      "paideuo_scheduled_sessions",
      "id = {:id} && owner = {:owner} && deleted = false",
      { id: args.id, owner: principal.ownerId },
    )[0];
    if (!record) throw rpcError(404, "Workout not found.");
    workout = presentWorkout(record);
  });
  return workout;
};

const createOneOffWorkout = (event, principal, args) => {
  requireScope(principal, "workouts:write");
  if (!args.scheduledDate || !args.timezone || !args.prescription || !args.operationId) {
    throw rpcError(-32602, "Provide scheduledDate, timezone, prescription, and operationId.");
  }
  const dates = require(__hooks + "/calendar-dates.js");
  if (!dates.parse(args.scheduledDate)) {
    throw rpcError(400, "Provide a valid scheduledDate.");
  }
  if (!dates.validTimezone(args.timezone)) {
    throw rpcError(400, "Provide a valid timezone.");
  }
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(args.operationId)) {
    throw rpcError(400, "Provide a valid operationId (UUID format).");
  }
  const parsePrescription = require(__hooks + "/workout-prescriptions.js");
  const snapshot = parsePrescription(args.prescription);
  const requestHash = $security.sha256(
    JSON.stringify([args.scheduledDate, args.timezone, snapshot]),
  );
  let id;
  event.app.runInTransaction((tx) => {
    const collection = "paideuo_scheduled_sessions";
    const existing = find(
      tx,
      collection,
      "owner = {:owner} && operation_id = {:operationId}",
      { owner: principal.ownerId, operationId: args.operationId },
    )[0];
    if (existing) {
      if (existing.getString("request_hash") !== requestHash) {
        throw rpcError(409, "This workout was already saved. Use a different operationId.");
      }
      id = existing.id;
      return;
    }
    const row = new Record(tx.findCollectionByNameOrId(collection), {
      owner: principal.ownerId,
      timezone: args.timezone,
      operation_id: args.operationId,
      request_hash: requestHash,
      scheduled_date: args.scheduledDate,
      original_date: args.scheduledDate,
      slot_position: 1,
      prescription_snapshot: JSON.stringify(snapshot),
      status: "planned",
    });
    tx.save(row);
    id = row.id;
  });
  return { id };
};

const editOneOffWorkout = (event, principal, args) => {
  requireScope(principal, "workouts:write");
  if (!args.id) throw rpcError(-32602, "Provide an id.");
  if (!args.prescription && !args.scheduledDate) {
    throw rpcError(-32602, "Provide either prescription or scheduledDate to edit.");
  }
  const dates = require(__hooks + "/calendar-dates.js");
  if (args.scheduledDate && !dates.parse(args.scheduledDate)) {
    throw rpcError(400, "Provide a valid scheduledDate.");
  }
  let workout = null;
  event.app.runInTransaction((tx) => {
    const collection = "paideuo_scheduled_sessions";
    const record = find(
      tx,
      collection,
      "id = {:id} && owner = {:owner} && deleted = false",
      { id: args.id, owner: principal.ownerId },
    )[0];
    if (!record) throw rpcError(404, "Workout not found.");
    if (args.prescription) {
      const parsePrescription = require(__hooks + "/workout-prescriptions.js");
      const snapshot = parsePrescription(args.prescription);
      record.set("prescription_snapshot", JSON.stringify(snapshot));
    }
    if (args.scheduledDate) {
      record.set("scheduled_date", args.scheduledDate);
    }
    tx.save(record);
    workout = presentWorkout(record);
  });
  return workout;
};

const deleteOneOffWorkout = (event, principal, args) => {
  requireScope(principal, "workouts:write");
  if (!args.id) throw rpcError(-32602, "Provide an id.");
  event.app.runInTransaction((tx) => {
    const collection = "paideuo_scheduled_sessions";
    const record = find(
      tx,
      collection,
      "id = {:id} && owner = {:owner} && deleted = false",
      { id: args.id, owner: principal.ownerId },
    )[0];
    if (!record) throw rpcError(404, "Workout not found.");
    record.set("deleted", true);
    tx.save(record);
  });
  return { id: args.id, deleted: true };
};

const callTool = (event, principal, name, args = {}) => {
  if (name === "list_programs") return listPrograms(event, principal);
  if (name === "get_program") return getProgram(event, principal, args);
  if (name === "create_draft") {
    requireImportScopes(principal, "program");
    const body = makeDraftDocument(args);
    if (args.operationId) body.operationId = args.operationId;
    return serviceResult(
      imports.domainBatch(cloneBodyEvent(event, body), "program", principal, { createOnly: true }),
    );
  }
  if (name === "preview_import") {
    requireImportScopes(principal, args.document?.kind);
    return serviceResult(imports.preview(cloneBodyEvent(event, args.document), principal));
  }
  if (name === "commit_import") {
    requireImportScopes(principal, args.document?.kind);
    const body = {
      previewToken: args.previewToken,
      document: args.document,
      approvalReceipt: args.approvalReceipt,
    };
    if (args.operationId) body.operationId = args.operationId;
    return serviceResult(
      imports.commit(cloneBodyEvent(event, body), principal, {
        requireApproval: true,
        generatedOperationId:
          typeof args.previewToken === "string"
            ? `mcp:${$security.sha256(args.previewToken)}`
            : null,
      }),
    );
  }
  if (name === "record_workout") {
    requireImportScopes(principal, "workout-component-results");
    const body = { ...args.data };
    if (args.operationId) body.operationId = args.operationId;
    if (args.replaceExistingCompletion != null) {
      body.replaceExistingCompletion = args.replaceExistingCompletion;
    }
    return serviceResult(
      imports.domainBatch(cloneBodyEvent(event, body), "workout-component-results", principal),
    );
  }
  if (name === "submit_check_ins") {
    requireImportScopes(principal, "daily-check-ins");
    const body = { entries: args.entries };
    if (args.operationId) body.operationId = args.operationId;
    return serviceResult(
      imports.domainBatch(cloneBodyEvent(event, body), "daily-check-ins", principal),
    );
  }
  if (name === "fetch_metrics") {
    requireScope(principal, "metrics:read");
    const metricEvent = {
      app: event.app,
      auth: { id: principal.ownerId },
      request: {
        url: {
          query: () => ({
            get: (key) =>
              ({
                view: args.view,
                program: args.program,
                start: args.start,
                end: args.end,
              })[key] ?? null,
          }),
        },
      },
      json: (status, value) => ({ status, value }),
    };
    const result = require(__hooks + "/metrics.js").report(metricEvent);
    return result.status ? serviceResult(result) : result;
  }
  if (name === "list_workouts") return listWorkouts(event, principal, args);
  if (name === "get_workout") return getWorkout(event, principal, args);
  if (name === "create_one_off_workout") return createOneOffWorkout(event, principal, args);
  if (name === "edit_one_off_workout") return editOneOffWorkout(event, principal, args);
  if (name === "delete_one_off_workout") return deleteOneOffWorkout(event, principal, args);
  throw rpcError(-32601, `Unknown tool: ${name}`);
};

const jsonRpc = (event, principal, request, oauthScope) => {
  if (!request || request.jsonrpc !== "2.0") {
    throw rpcError(-32600, "Invalid JSON-RPC request.");
  }
  if (request.method === "initialize") {
    return {
      protocolVersion: ["2025-03-26", "2025-06-18", "2025-11-25"].includes(
        request.params?.protocolVersion,
      )
        ? request.params.protocolVersion
        : "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "paideuo-mcp", version: "1.0.0" },
    };
  }
  if (request.method === "notifications/initialized") return null;
  if (request.method === "ping") return {};
  if (request.method === "tools/list") {
    if (!oauthScope) return { tools };
    return {
      tools: tools.map((tool) => ({
        ...tool,
        _meta: { securitySchemes: [{ type: "oauth2", scopes: [oauthScope] }] },
      })),
    };
  }
  if (request.method === "tools/call") {
    const params = request.params;
    if (!params || typeof params.name !== "string") throw rpcError(-32602, "Invalid tool call.");
    const args = params.arguments ?? {};
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw rpcError(-32602, "Tool arguments must be an object.");
    }
    const toolResult = (value, isError) => {
      const structuredContent = Array.isArray(value) ? { items: value } : value;
      return {
        content: [{ type: "text", text: JSON.stringify(structuredContent) }],
        structuredContent,
        isError,
      };
    };
    try {
      return toolResult(callTool(event, principal, params.name, args), false);
    } catch (error) {
      if (error.rpcCode === -32601) throw error;
      const status = error.status ?? (error.name === "ImportValidationError" ? 400 : 500);
      return toolResult(
        {
          status,
          message: status < 500 ? error.message : "The operation failed.",
          ...(error.details ? { details: error.details } : {}),
        },
        true,
      );
    }
  }
  throw rpcError(-32601, `Method not found: ${request.method}`);
};

const handle = (event, { oauthScope } = {}) => {
  const body = event.requestInfo().body;
  let principal = null;
  try {
    principal = principalForEvent(event);
  } catch (error) {
    if (body?.method === "initialize" || body?.method === "ping") principal = null;
    else throw error;
  }
  if (Array.isArray(body)) {
    throw rpcError(-32600, "Batch JSON-RPC requests are not supported.");
  }
  try {
    if (!principal && body?.method?.startsWith("tools/")) {
      throw rpcError(401, "Unauthorized.");
    }
    const value = jsonRpc(event, principal, body, oauthScope);
    if (body?.method?.startsWith("notifications/")) return event.noContent(202);
    return event.json(200, { jsonrpc: "2.0", id: body?.id ?? null, result: value });
  } catch (error) {
    const code =
      error.rpcCode ?? (error.status === 401 ? -32001 : error.status === 403 ? -32003 : -32000);
    return event.json(error.status && error.status >= 400 ? error.status : 200, {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code, message: error.message || "MCP request failed" },
    });
  }
};

module.exports = { tools, principalForEvent, callTool, handle };
