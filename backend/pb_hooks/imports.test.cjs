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
serviceModule.require = (id) => {
  if (id === path.join(__dirname, "import-schemas.js")) return schemaModule;
  if (id === path.join(__dirname, "calendar-sessions.js")) {
    return { todayIn: () => "2099-12-31" };
  }
  return nativeRequire(id);
};
serviceModule._compile(
  `${fs.readFileSync(serviceFilename, "utf8")}
module.exports.__test = {
  reconcileTrainingComponents,
  observationPlan,
  commitWorkout,
  requestWindows,
};`,
  serviceFilename,
);
const { commit, preview, __test } = serviceModule.exports;

class FakeRecord {
  constructor(collection, fields = {}) {
    this.collection = collection;
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

  getInt(key) {
    const value = this.get(key);
    return Number.isFinite(value) ? Math.trunc(value) : 0;
  }

  getBool(key) {
    return Boolean(this.get(key));
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
  const state = { saves: 0, records: new Map(), operations: new Map() };
  return {
    state,
    findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
      if (collection === "paideuo_import_operations") {
        const record = state.operations.get(`${params.owner}:${params.operationId}`);
        return record ? [record] : [];
      }
      if (collection !== "paideuo_daily_recovery") return [];
      const record = state.records.get(params.date);
      return record ? [record] : [];
    },
    findCollectionByNameOrId(name) {
      return { name };
    },
    save(record) {
      state.saves += 1;
      if (record.collection?.name === "paideuo_import_operations") {
        state.operations.set(`${record.fields.owner}:${record.fields.operation_id}`, record);
        return;
      }
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

test("operation replay returns the same result and conflicting reuse is rejected", () => {
  const db = database();
  const source = document();
  const prepared = preview(event(db, source)).value;
  const first = commit(
    event(db, {
      document: source,
      previewToken: prepared.previewToken,
      operationId: "import-001",
      sourceLabel: "sensor",
      credentialRef: "credential-001",
    }),
  );

  assert.equal(first.status, 200);
  assert.equal(first.value.operationId, "import-001");
  assert.equal(first.value.audit.provenance.sourceLabel, "sensor");
  assert.equal(first.value.audit.provenance.actor, "owner-id");
  assert.equal(first.value.audit.provenance.credentialRef, "user:owner-id");
  assert.equal(first.value.audit.provenance.sourceCredentialRef, "credential-001");
  assert.equal(first.value.audit.summary.created, 1);

  const replay = commit(
    event(db, {
      document: source,
      previewToken: prepared.previewToken,
      operationId: "import-001",
    }),
  );
  assert.deepEqual(replay.value, first.value);

  const changed = structuredClone(source);
  changed.data.entries[0].recovery.sleepHours = 9;
  assert.throws(
    () =>
      commit(
        event(db, {
          document: changed,
          previewToken: prepared.previewToken,
          operationId: "import-001",
        }),
      ),
    (error) => error.status === 409 && /different import payload/.test(error.message),
  );
});

test("operation replay does not revalidate references after the commit", () => {
  const source = {
    schema: "paideuo",
    version: 1,
    kind: "workout-component-results",
    data: {
      sourceSessionId: "deleted-session",
      sourceWorkoutKey: "workout-1",
      completedDate: "2026-11-18",
      actualDurationMin: 45,
      sessionRpe: 7,
      notes: "",
      components: [],
    },
  };
  const normalized = schemaModule.normalize(source, { authorizeReference: () => true });
  const operation = new FakeRecord(
    { name: "paideuo_import_operations" },
    {
      owner: "owner-id",
      operation_id: "workout-001",
      payload_hash: crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
      provenance_json: JSON.stringify({ actor: "owner-id" }),
      summary_json: JSON.stringify({ committed: 1 }),
      result_json: JSON.stringify({ committed: true, operationId: "workout-001" }),
    },
  );
  const db = {
    findRecordsByFilter(collection) {
      if (collection !== "paideuo_import_operations") {
        throw new Error("Replay unexpectedly revalidated a domain reference.");
      }
      return [operation];
    },
    findCollectionByNameOrId() {
      throw new Error("Replay unexpectedly attempted a write.");
    },
  };

  const response = commit(
    event(db, {
      document: source,
      previewToken: "already-consumed",
      operationId: "workout-001",
    }),
  );

  assert.deepEqual(response.value, { committed: true, operationId: "workout-001" });
});

test("import requests are bounded by encoded byte size", () => {
  const db = database();
  const source = document();
  source.data.entries = Array.from({ length: 367 }, (_, index) => ({
    date: `2026-11-${String(index + 1).padStart(2, "0")}`,
  }));

  assert.throws(
    () => preview(event(db, source)),
    (error) => /at most 366/.test(error.message),
  );

  const oversized = source;
  oversized.data.entries = [];
  oversized.padding = "x".repeat(2 * 1024 * 1024 + 1);
  assert.throws(
    () => preview(event(db, oversized)),
    (error) => error.status === 413,
  );
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

test("reconcileTrainingComponents preserves unchanged ids and updates in place", () => {
  const components = [
    new FakeRecord(
      {},
      {
        id: "component-a",
        prescription: "prescription-1",
        position: 1,
        name: "Warm-up",
        instructions: "Easy movement",
        duration_min: 10,
        duration_specified: true,
        targets: { intensity: { value: 3, scale: "RPE" } },
      },
    ),
    new FakeRecord(
      {},
      {
        id: "component-b",
        prescription: "prescription-1",
        position: 2,
        name: "Main set",
        instructions: "Limit boulders",
        duration_min: 25,
        duration_specified: true,
        targets: { intensity: { value: 7, scale: "RPE" } },
      },
    ),
  ];
  const db = {
    state: { components, saves: 0, deletes: 0 },
    findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
      if (collection !== "paideuo_training_components") return [];
      return this.state.components
        .filter((record) => record.getString("prescription") === params.id)
        .slice()
        .sort((left, right) => left.getInt("position") - right.getInt("position"));
    },
    findCollectionByNameOrId(name) {
      return { name };
    },
    save(record) {
      this.state.saves += 1;
      const index = this.state.components.findIndex((candidate) => candidate.id === record.id);
      if (index === -1) this.state.components.push(record);
      else this.state.components[index] = record;
    },
    delete(record) {
      this.state.deletes += 1;
      this.state.components = this.state.components.filter(
        (candidate) => candidate.id !== record.id,
      );
    },
  };

  __test.reconcileTrainingComponents(db, "prescription-1", [
    {
      name: "Warm-up",
      instructions: "Easy movement",
      durationMin: 10,
      targets: { intensity: { value: 3, scale: "RPE" } },
    },
    {
      name: "Main set",
      instructions: "Project tries",
      durationMin: 25,
      targets: { intensity: { value: 7, scale: "RPE" } },
    },
  ]);

  assert.equal(db.state.deletes, 0);
  assert.equal(db.state.components[0].id, "component-a");
  assert.equal(db.state.components[1].id, "component-b");
  assert.equal(db.state.components[1].getString("instructions"), "Project tries");
});

test("workout result preview conflicts even when replacement is requested", () => {
  const session = new FakeRecord(
    {},
    {
      id: "session-1",
      schedule: "",
      timezone: "UTC",
      source_prescription_id: "",
      scheduled_date: "2026-11-18",
      original_date: "2026-11-18",
      status: "completed",
      deleted: false,
      manually_moved: false,
      manually_edited: false,
      prescription_snapshot: null,
    },
  );
  const completion = new FakeRecord(
    {},
    {
      id: "completion-1",
      session: "session-1",
      completed_date: "2026-11-18",
      actual_duration_min: 45,
      session_rpe: 7,
      notes: "Saved manually",
    },
  );
  const db = {
    findRecordById(collection, id) {
      if (collection === "paideuo_scheduled_sessions" && id === "session-1") return session;
      throw new Error(`Unexpected lookup ${collection}:${id}`);
    },
    findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
      if (collection === "paideuo_session_completions") {
        return params.id === "session-1" ? [completion] : [];
      }
      if (collection === "paideuo_workout_component_results") {
        return [
          new FakeRecord(
            {},
            {
              id: "row-1",
              session: "session-1",
              component_key: "warm-up",
              planned_position: 1,
              name: "Warm-up",
              completed: true,
              actual_duration_min: 15,
              sets_completed: null,
              reps_completed: "",
              actual_load: null,
              rpe: null,
              notes: "",
            },
          ),
        ];
      }
      return [];
    },
  };

  const plan = __test.observationPlan(db, "owner-id", {
    kind: "workout-component-results",
    data: {
      sourceSessionId: "session-1",
      sourceWorkoutKey: "workout-1",
      completedDate: "2026-11-18",
      actualDurationMin: 45,
      sessionRpe: 7,
      notes: "Adjusted notes",
      components: [
        {
          key: "warm-up",
          plannedPosition: 1,
          name: "Warm-up",
          completed: true,
          actualDurationMin: 15,
          setsCompleted: null,
          repsCompleted: null,
          actualLoad: null,
          rpe: null,
          notes: "Changed",
        },
      ],
      replaceExistingCompletion: true,
    },
  });

  assert.equal(plan.items[0].status, "conflict");
  assert.match(plan.items[0].error, /destructive-history authorization/);
});

test("commitWorkout rejects caller-requested historical overwrite", () => {
  const completion = new FakeRecord(
    {},
    {
      id: "completion-1",
      session: "session-1",
      completed_date: "2026-11-18",
      actual_duration_min: 45,
      session_rpe: 7,
      notes: "Saved manually",
    },
  );
  const db = {
    state: { saves: 0, deletes: 0 },
    findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
      if (collection === "paideuo_session_completions") {
        return params.session === "session-1" ? [completion] : [];
      }
      if (collection === "paideuo_workout_component_results") return [];
      return [];
    },
    findCollectionByNameOrId(name) {
      return { name };
    },
    findRecordById() {
      return new FakeRecord({}, { id: "session-1", status: "scheduled" });
    },
    save() {
      this.state.saves += 1;
    },
    delete() {
      this.state.deletes += 1;
    },
  };

  assert.throws(
    () =>
      __test.commitWorkout(
        db,
        "owner-id",
        {
          sourceWorkoutKey: "workout-1",
          completedDate: "2026-11-18",
          actualDurationMin: 45,
          sessionRpe: 7,
          notes: "Adjusted",
          components: [],
          replaceExistingCompletion: true,
        },
        {
          items: [{ status: "update" }],
          state: [{ sessionId: "session-1" }],
        },
      ),
    (error) =>
      error instanceof ApiError &&
      error.status === 409 &&
      /not supported by the import endpoint/.test(error.message),
  );
  assert.equal(db.state.saves, 0);
  assert.equal(db.state.deletes, 0);
});

test("commitWorkout allows authorized historical overwrite", () => {
  const completion = new FakeRecord(
    {},
    {
      id: "completion-1",
      session: "session-1",
      completed_date: "2026-11-18",
      actual_duration_min: 45,
      session_rpe: 7,
      notes: "Saved manually",
    },
  );
  const db = {
    state: { saves: 0, deletes: 0 },
    findRecordsByFilter(collection, _filter, _sort, _limit, _offset, params) {
      if (collection === "paideuo_session_completions") {
        return params.session === "session-1" ? [completion] : [];
      }
      if (collection === "paideuo_workout_component_results") return [];
      return [];
    },
    findCollectionByNameOrId(name) {
      return { name };
    },
    findRecordById() {
      return new FakeRecord({}, { id: "session-1", status: "scheduled" });
    },
    save() {
      this.state.saves += 1;
    },
    delete() {
      this.state.deletes += 1;
    },
  };

  const result = __test.commitWorkout(
    db,
    "owner-id",
    {
      sourceWorkoutKey: "workout-1",
      completedDate: "2026-11-18",
      actualDurationMin: 42,
      sessionRpe: 8,
      notes: "Imported overwrite",
      components: [],
      replaceExistingCompletion: true,
    },
    {
      items: [{ status: "update" }],
      state: [{ sessionId: "session-1" }],
    },
    { allowHistoryRewrite: true },
  );

  assert.deepEqual(result, [{ key: "workout-1", status: "committed" }]);
  assert.equal(db.state.saves > 0, true);
});

test("rate limiting expires owner windows and rejects request 61", () => {
  const db = database();
  const source = document();
  const requestEvent = event(db, source);
  requestEvent.auth.id = "rate-limited-owner";
  __test.requestWindows.clear();

  for (let index = 0; index < 60; index += 1) {
    assert.equal(preview(requestEvent).status, 200);
  }
  assert.throws(
    () => preview(requestEvent),
    (error) => error.status === 429 && /rate limit/.test(error.message),
  );

  __test.requestWindows.get("rate-limited-owner").expiresAt = Date.now() - 1;
  assert.equal(preview(requestEvent).status, 200);
});
