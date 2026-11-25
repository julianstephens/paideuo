/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

global.__hooks = __dirname;
global.BadRequestError = class BadRequestError extends Error {};
global.ApiError = class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
global.NotFoundError = class NotFoundError extends Error {};
global.$security = {
  sha256: (input) => `hash_${Buffer.from(input).toString("base64").slice(0, 8)}`,
  randomString: (length) => Buffer.alloc(length / 2).toString("hex"),
};
global.Record = class Record {
  constructor(collection, data = {}) {
    this.id = data.id || `rec_${$security.randomString(16)}`;
    this.collection = typeof collection === "string" ? collection : (collection?.name ?? "");
    this.data = { ...data };
  }
  set(key, value) {
    this.data[key] = value;
  }
  get(key) {
    return this.data[key];
  }
  getString(key) {
    const value = this.data[key];
    return key === "prescription_snapshot" && value && typeof value === "object"
      ? JSON.stringify(value)
      : (value ?? "");
  }
  getInt(key) {
    return parseInt(this.data[key] || "0", 10);
  }
  getBool(key) {
    return Boolean(this.data[key]);
  }
};

const credentials = {
  requiredScopesForImportKind: () => ["imports:commit"],
  servicePrincipalFromEvent: () => ({
    type: "service",
    ownerId: "owner",
    scopes: new Set(["programs:read", "metrics:read", "workouts:read", "workouts:write"]),
  }),
  importPrincipalFromEvent: () => ({
    type: "user",
    ownerId: "owner",
    scopes: new Set(),
  }),
};
const imports = {
  preview: () => ({ status: 200, value: { previewToken: "preview", items: [] } }),
  commit: () => ({ status: 200, value: { committed: true } }),
  domainBatch: () => ({ status: 200, value: { created: 1, updated: 0, skipped: 0, error: 0 } }),
};

const filename = path.join(__dirname, "mcp-tools.js");
const source = new Module(filename);
source.filename = filename;
source.paths = Module._nodeModulePaths(__dirname);
source.require = (id) => {
  if (id === path.join(__hooks, "nutrition-adapters.cjs")) {
    const { foodToolScopes, mcpContract } = require("./nutrition-contracts.cjs");
    return {
      foodMcpOperations: new Map(
        [...foodToolScopes.keys()].map((name) => [
          name,
          { contract: mcpContract(name.replace("nutrition_foods_", "foods.")) },
        ]),
      ),
    };
  }
  if (id === path.join(__hooks, "nutrition-contracts.cjs")) return require(id);
  if (id === path.join(__hooks, "service-credentials.cjs")) return credentials;
  if (id === path.join(__hooks, "imports.js")) return imports;
  if (id === path.join(__hooks, "mcp-program-edits.cjs")) return require(id);
  if (id === path.join(__hooks, "calendar-dates.js")) {
    return {
      parse: (dateStr) => {
        try {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
          const date = new Date(`${dateStr}T00:00:00Z`);
          return Number.isFinite(date.getTime()) ? date : null;
        } catch {
          return null;
        }
      },
      validTimezone: (tz) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
    };
  }
  if (id === path.join(__hooks, "workout-prescriptions.js")) {
    return (prescription) => prescription;
  }
  throw new Error(`Unexpected require: ${id}`);
};
source._compile(fs.readFileSync(filename, "utf8"), filename);
const { tools, handle, callTool } = source.exports;

const event = (body) => {
  const records = new Map();
  const mockTx = {
    findRecordsByFilter: (collection) => {
      return Array.from(records.values()).filter(
        (r) => r.collection === collection && !r.getBool("deleted"),
      );
    },
    findCollectionByNameOrId: (name) => ({ name, id: `coll_${name}` }),
    save: (record) => {
      records.set(record.id, record);
    },
    expandRecords: () => {},
    delete: (record) => {
      records.delete(record.id);
    },
  };
  return {
    records,
    app: {
      findRecordsByFilter: (collection, filter, sort, skip, limit, params) =>
        mockTx.findRecordsByFilter(collection, filter, sort, skip, limit, params),
      runInTransaction: (callback) => callback(mockTx),
      findCollectionByNameOrId: (name) => mockTx.findCollectionByNameOrId(name),
    },
    auth: { id: "owner" },
    request: { header: { get: () => "" } },
    requestInfo: () => ({ body }),
    json: (status, value) => ({ status, value }),
  };
};

test("MCP advertises ingestion and direct program editing tools", () => {
  const names = tools.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of [
    "list_programs",
    "get_program",
    "create_draft",
    "preview_import",
    "commit_import",
    "record_workout",
    "submit_check_ins",
    "fetch_metrics",
    "list_workouts",
    "get_workout",
    "create_one_off_workout",
    "edit_one_off_workout",
    "delete_one_off_workout",
    "edit_program",
    "get_program_workout",
    "edit_program_workout",
    "edit_session_template",
    "preview_program_calendar_changes",
    "apply_program_calendar_changes",
  ])
    assert.ok(names.includes(name), name);
});

test("read-only service cannot create or commit", () => {
  const principal = credentials.servicePrincipalFromEvent();
  assert.throws(
    () =>
      callTool(event({}), principal, "create_draft", {
        name: "Draft",
        externalId: "draft",
      }),
    /Missing required scope/,
  );
  assert.throws(
    () =>
      callTool(event({}), principal, "commit_import", {
        previewToken: "preview",
        document: { kind: "daily-check-ins" },
      }),
    /Missing required scope/,
  );
});

test("tools/list and tools/call are JSON-RPC responses", () => {
  const list = handle(event({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  assert.equal(list.status, 200);
  assert.deepEqual(list.value.result.tools, tools);
});

test("one-off workout CRUD behavior", () => {
  const evt = event({});
  const principal = credentials.servicePrincipalFromEvent();
  const operationId = "12345678-1234-1234-1234-123456789abc";
  const prescription = { title: "Day 1", components: [] };

  const created = callTool(evt, principal, "create_one_off_workout", {
    scheduledDate: "2026-01-10",
    timezone: "UTC",
    prescription,
    operationId,
  });
  assert.equal(evt.records.size, 1);

  const idempotent = callTool(evt, principal, "create_one_off_workout", {
    scheduledDate: "2026-01-10",
    timezone: "UTC",
    prescription,
    operationId,
  });
  assert.equal(idempotent.id, created.id);
  assert.equal(evt.records.size, 1);

  const edited = callTool(evt, principal, "edit_one_off_workout", {
    id: created.id,
    scheduledDate: "2026-01-11",
  });
  assert.equal(edited.scheduledDate, "2026-01-11");

  const fetched = callTool(evt, principal, "get_workout", { id: created.id });
  assert.equal(fetched.id, created.id);
  assert.equal(fetched.scheduledDate, "2026-01-11");

  const deleted = callTool(evt, principal, "delete_one_off_workout", { id: created.id });
  assert.deepEqual(deleted, { id: created.id, deleted: true });
  assert.throws(
    () => callTool(evt, principal, "get_workout", { id: created.id }),
    /Workout not found/,
  );
});
