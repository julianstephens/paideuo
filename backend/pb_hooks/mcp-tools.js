/* oxlint-disable import/no-commonjs */
const credentials = require(__hooks + "/service-credentials.cjs");
const imports = require(__hooks + "/imports.js");

const tools = [
  {
    name: "list_programs",
    description: "List programs owned by the authenticated principal.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_program",
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
  throw rpcError(-32601, `Unknown tool: ${name}`);
};

const jsonRpc = (event, principal, request) => {
  if (!request || request.jsonrpc !== "2.0") {
    throw rpcError(-32600, "Invalid JSON-RPC request.");
  }
  if (request.method === "initialize") {
    return {
      protocolVersion: "2025-06-18",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "paideuo-mcp", version: "1.0.0" },
    };
  }
  if (request.method === "notifications/initialized") return null;
  if (request.method === "ping") return {};
  if (request.method === "tools/list") return { tools };
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

const handle = (event) => {
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
    const value = jsonRpc(event, principal, body);
    if (body?.method?.startsWith("notifications/")) return event.json(202, {});
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
