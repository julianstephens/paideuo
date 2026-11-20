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

const credentials = {
  servicePrincipalFromEvent: () => ({
    type: "service",
    ownerId: "owner",
    scopes: new Set(["programs:read", "metrics:read"]),
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
  if (id === path.join(__dirname, "service-credentials.cjs")) return credentials;
  if (id === path.join(__dirname, "imports.js")) return imports;
  throw new Error(`Unexpected require: ${id}`);
};
source._compile(fs.readFileSync(filename, "utf8"), filename);
const { tools, handle, callTool } = source.exports;

const event = (body) => ({
  app: {
    findRecordsByFilter: () => [],
  },
  auth: { id: "owner" },
  request: { header: { get: () => "" } },
  requestInfo: () => ({ body }),
  json: (status, value) => ({ status, value }),
});

test("MCP exposes the constrained ingestion tool set", () => {
  const names = tools.map((tool) => tool.name);
  assert.deepEqual(names, [
    "list_programs",
    "get_program",
    "create_draft",
    "preview_import",
    "commit_import",
    "record_workout",
    "submit_check_ins",
    "fetch_metrics",
  ]);
});

test("read-only service cannot create or commit", () => {
  const principal = credentials.servicePrincipalFromEvent();
  assert.throws(
    () => callTool(event({}), principal, "create_draft", {
      name: "Draft",
      externalId: "draft",
    }),
    /Missing required scope/,
  );
  assert.throws(
    () => callTool(event({}), principal, "commit_import", {
      previewToken: "preview",
      document: { kind: "daily-check-ins" },
    }),
    /Missing required scope/,
  );
});

test("tools/list and tools/call are JSON-RPC responses", () => {
  const list = handle(event({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
  assert.equal(list.status, 200);
  assert.equal(list.value.result.tools.length, 8);
});
