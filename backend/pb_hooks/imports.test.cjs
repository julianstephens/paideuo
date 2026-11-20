/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

global.BadRequestError = class BadRequestError extends Error {};
global.ApiError = class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
};
global.__hooks = __dirname;
global.$security = {
  randomString: () => "stable-test-preview-secret",
  sha256: (value) => crypto.createHash("sha256").update(value).digest("hex"),
};

const compile = (filename) => {
  const result = new Module(filename);
  result.filename = filename;
  result.paths = Module._nodeModulePaths(path.dirname(filename));
  result._compile(fs.readFileSync(filename, "utf8"), filename);
  return result.exports;
};

const schemaModule = compile(path.join(__dirname, "import-schemas.js"));
const serviceFilename = path.join(__dirname, "imports.js");
const serviceModule = new Module(serviceFilename);
serviceModule.filename = serviceFilename;
serviceModule.paths = Module._nodeModulePaths(__dirname);
const nativeRequire = Module.prototype.require.bind(serviceModule);
serviceModule.require = (id) =>
  id === path.join(__dirname, "import-schemas.js") ? schemaModule : nativeRequire(id);
serviceModule._compile(fs.readFileSync(serviceFilename, "utf8"), serviceFilename);
const { commit, preview } = serviceModule.exports;

class FakeRecord {
  constructor(_collection, fields = {}) {
    this.id = fields.id ?? `record-${Math.random()}`;
    this.fields = { ...fields };
  }

  get(key) {
    return this.fields[key] ?? null;
  }

  getString(key) {
    const value = this.get(key);
    if (value == null) return "";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  set(key, value) {
    this.fields[key] = value;
  }
}

global.Record = FakeRecord;

const document = () => ({
  schema: "paideuo",
  version: 1,
  kind: "daily-check-ins",
  data: {
    entries: [
      {
        date: "2026-11-20",
        recovery: { sleepHours: 8 },
        nutrition: { proteinGrams: 100 },
      },
    ],
  },
});

const database = () => {
  const state = { saves: 0, records: new Map() };
  return {
    state,
    findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
      if (collection !== "paideuo_daily_recovery") return [];
      const record = state.records.get(params.date);
      return record ? [record] : [];
    },
    findCollectionByNameOrId(name) {
      return { name };
    },
    save(record) {
      state.saves += 1;
      state.records.set(record.fields.date, record);
    },
    runInTransaction(callback) {
      return callback(this);
    },
  };
};

const event = (app, body) => ({
  app,
  auth: { id: "owner-id" },
  requestInfo: () => ({ body }),
  json: (status, value) => ({ status, value }),
});

test("preview does not mutate data and reports create", () => {
  const db = database();
  const response = preview(event(db, document()));

  assert.equal(response.status, 200);
  assert.equal(response.value.items[0].status, "create");
  assert.match(response.value.previewToken, /^[a-f0-9]{64}$/);
  assert.equal(db.state.saves, 0);
});

test("commit rejects a tampered document", () => {
  const db = database();
  const source = document();
  const prepared = preview(event(db, source)).value;
  const changed = structuredClone(source);
  changed.data.entries[0].recovery.sleepHours = 9;

  assert.throws(
    () => commit(event(db, { document: changed, previewToken: prepared.previewToken })),
    (error) => error.status === 409 && /tampered/.test(error.message),
  );
  assert.equal(db.state.saves, 0);
});

test("commit applies once and rejects a stale replay", () => {
  const db = database();
  const source = document();
  const prepared = preview(event(db, source)).value;
  const result = commit(event(db, { document: source, previewToken: prepared.previewToken }));

  assert.equal(result.status, 200);
  assert.deepEqual(result.value.rows, [{ key: "2026-11-20", status: "created" }]);
  assert.equal(db.state.saves, 1);
  assert.throws(
    () => commit(event(db, { document: source, previewToken: prepared.previewToken })),
    (error) => error.status === 409,
  );
  assert.equal(db.state.saves, 1);
});

test("preview and commit preserve per-row skip status", () => {
  const db = database();
  const source = document();
  const record = new FakeRecord(
    {},
    {
      owner: "owner-id",
      date: "2026-11-20",
      measurements: schemaModule.normalize(source).data.entries[0].recovery,
      nutrition: schemaModule.normalize(source).data.entries[0].nutrition,
    },
  );
  db.state.records.set("2026-11-20", record);
  const prepared = preview(event(db, source)).value;

  assert.equal(prepared.items[0].status, "skip");
  const result = commit(event(db, { document: source, previewToken: prepared.previewToken }));
  assert.deepEqual(result.value.rows, [{ key: "2026-11-20", status: "skipped" }]);
  assert.equal(db.state.saves, 0);
  assert.throws(
    () => commit(event(db, { document: source, previewToken: prepared.previewToken })),
    (error) => error.status === 409 && /already been committed/.test(error.message),
  );
});
