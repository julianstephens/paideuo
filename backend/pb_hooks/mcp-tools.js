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
    description: "Get a single owned program.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, externalId: { type: "string" } },
      additionalProperties: false,
      anyOf: [{ required: ["id"] }, { required: ["externalId"] }],
    },
  },
  {
    name: "create_draft",
    description: "Create or reconcile a draft program through the ingestion domain service.",
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
    description: "Commit an exact previewed import. Scheduled/completed plan changes require explicit approval.",
    inputSchema: {
      type: "object",
      properties: {
        previewToken: { type: "string" },
        document: { type: "object" },
        approvedScheduledPlanChanges: { type: "boolean", const: true },
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
  const error = new ApiError(status, message);
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
  const header = event.request?.header?.get("Authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match) return credentials.servicePrincipalFromEvent(event);
  if (event.auth?.id) {
    return credentials.importPrincipalFromEvent(event);
  }
  throw rpcError(401, "Unauthorized.");
};

const requireScope = (principal, scope) => {
  if (principal.type === "user") return;
  if (!principal.scopes.has(scope)) throw rpcError(403, `Missing required scope: ${scope}.`);
};

const cloneBodyEvent = (event, body) => ({
  app: event.app,
  auth: event.auth ?? { id: principalForEvent(event).ownerId },
  requestInfo: () => ({ body }),
  request: event.request,
  json: (status, value) => ({ status, value }),
});

const find = (db, collection, filter, params, sort = "") =>
  db.findRecordsByFilter(collection, filter, sort, 0, 0, params);

const listPrograms = (event, principal) => {
  requireScope(principal, "programs:read");
  return find(event.app, "paideuo_programs", "owner = {:owner}", { owner: principal.ownerId }, "-updated")
    .map((record) => ({
      id: record.id,
      externalId: record.getString("external_id"),
      name: record.getString("name"),
      status: record.getString("status"),
    }));
};

const getProgram = (event, principal, args) => {
  requireScope(principal, "programs:read");
  if (!args.id && !args.externalId) throw new BadRequestError("Provide a program id or externalId.");
  const filter = args.id
    ? "id = {:id} && owner = {:owner}"
    : "external_id = {:externalId} && owner = {:owner}";
  const params = args.id
    ? { id: args.id, owner: principal.ownerId }
    : { externalId: args.externalId, owner: principal.ownerId };
  const record = find(event.app, "paideuo_programs", filter, params)[0];
  if (!record) throw new NotFoundError("Program not found.");
  let result;
  event.app.runInTransaction((tx) => {
    const schedule = find(tx, "paideuo_program_schedules", "program = {:program}", { program: record.id })[0];
    const blocks = find(tx, "paideuo_blocks", "program = {:program}", { program: record.id }, "position,id");
    result = {
      id: record.id,
      externalId: record.getString("external_id"),
      name: record.getString("name"),
      objective: record.getString("objective"),
      description: record.getString("description"),
      status: record.getString("status"),
      scheduled: Boolean(schedule),
      blocks: blocks.map((block) => ({
        id: block.id,
        externalId: block.getString("external_id"),
        name: block.getString("name"),
        position: block.getInt("position"),
        durationWeeks: block.getInt("duration_weeks"),
      })),
    };
  });
  return result;
};

const approvalRequired = (event, principal, document) => {
  if (document?.kind !== "program") return false;
  const externalId = document?.data?.program?.externalId;
  const id = document?.data?.program?.id;
  if (!externalId && !id) return false;
  const filter = id
    ? "id = {:id} && owner = {:owner}"
    : "external_id = {:externalId} && owner = {:owner}";
  const params = id
    ? { id, owner: principal.ownerId }
    : { externalId, owner: principal.ownerId };
  const record = find(event.app, "paideuo_programs", filter, params)[0];
  if (!record) return false;
  if (record.getString("status") === "completed") return true;
  return Boolean(
    find(event.app, "paideuo_program_schedules", "program = {:program}", {
      program: record.id,
    })[0],
  );
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
    requireScope(principal, "programs:write");
    const body = makeDraftDocument(args);
    if (args.operationId) body.operationId = args.operationId;
    return imports.domainBatch(cloneBodyEvent(event, body), "program", principal).value;
  }
  if (name === "preview_import") {
    requireScope(principal, "imports:commit");
    const kind = args.document?.kind;
    if (kind === "program") requireScope(principal, "programs:write");
    if (kind === "workout-component-results") requireScope(principal, "workouts:write");
    if (kind === "daily-check-ins") requireScope(principal, "metrics:write");
    if (kind === "heart-rate-recording") requireScope(principal, "recordings:write");
    return imports.preview(cloneBodyEvent(event, args.document), principal).value;
  }
  if (name === "commit_import") {
    requireScope(principal, "imports:commit");
    const kind = args.document?.kind;
    if (kind === "program") requireScope(principal, "programs:write");
    if (kind === "workout-component-results") requireScope(principal, "workouts:write");
    if (kind === "daily-check-ins") requireScope(principal, "metrics:write");
    if (kind === "heart-rate-recording") requireScope(principal, "recordings:write");
    if (approvalRequired(event, principal, args.document) && args.approvedScheduledPlanChanges !== true) {
      throw rpcError(409, "Explicit approval is required to change a scheduled or completed plan.");
    }
    const body = {
      previewToken: args.previewToken,
      document: args.document,
    };
    if (args.operationId) body.operationId = args.operationId;
    return imports.commit(cloneBodyEvent(event, body), principal).value;
  }
  if (name === "record_workout") {
    requireScope(principal, "workouts:write");
    const body = { ...args.data };
    if (args.operationId) body.operationId = args.operationId;
    if (args.replaceExistingCompletion != null) {
      body.replaceExistingCompletion = args.replaceExistingCompletion;
    }
    return imports.domainBatch(cloneBodyEvent(event, body), "workout-component-results", principal).value;
  }
  if (name === "submit_check_ins") {
    requireScope(principal, "metrics:write");
    const body = { entries: args.entries };
    if (args.operationId) body.operationId = args.operationId;
    return imports.domainBatch(cloneBodyEvent(event, body), "daily-check-ins", principal).value;
  }
  if (name === "fetch_metrics") {
    requireScope(principal, "metrics:read");
    const metricEvent = {
      app: event.app,
      auth: { id: principal.ownerId },
      request: {
        url: {
          query: () => ({
            get: (key) => ({
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
    return result.status ? result.value : result;
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
    const value = callTool(event, principal, params.name, args);
    return {
      content: [{ type: "text", text: JSON.stringify(value) }],
      structuredContent: value,
      isError: false,
    };
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
    const code = error.rpcCode ?? (error.status === 401 ? -32001 : error.status === 403 ? -32003 : -32000);
    return event.json(error.status && error.status >= 400 ? error.status : 200, {
      jsonrpc: "2.0",
      id: body?.id ?? null,
      error: { code, message: error.message || "MCP request failed" },
    });
  }
};

module.exports = { tools, principalForEvent, callTool, handle };
