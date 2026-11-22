/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

global.__hooks = __dirname;

const filename = path.join(__dirname, "import-schemas.js");
const sourceModule = new Module(filename);
sourceModule.filename = filename;
sourceModule.paths = Module._nodeModulePaths(__dirname);
sourceModule._compile(fs.readFileSync(filename, "utf8"), filename);
const { ImportValidationError, normalize } = sourceModule.exports;

const envelope = (kind, data) => ({ schema: "paideuo", version: 1, kind, data });
const sample = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "docs", "examples", name), "utf8"));

const program = () =>
  envelope("program", {
    program: {
      id: "program-record-id",
      externalId: "foundation-program",
      name: "  Foundation  ",
      description: undefined,
    },
    blocks: [
      {
        externalId: "base",
        name: "Base",
        position: 1,
        durationWeeks: 1,
        slots: [
          {
            externalId: "monday",
            weekday: 1,
            position: 1,
            label: "Climbing",
          },
        ],
        weeks: [
          {
            externalId: "base-week-1",
            position: 1,
            weekType: "normal",
            prescriptions: [
              {
                slotExternalId: "monday",
                workout: {
                  title: "Technique",
                  sessionType: "climbing",
                  components: [
                    {
                      name: "Warm-up",
                      durationMin: 10,
                      targets: { intensity: { value: 3, scale: "RPE" } },
                    },
                  ],
                },
              },
            ],
          },
        ],
      },
    ],
  });

test("normalizes a versioned hierarchical program without mutating input", () => {
  const input = program();
  const original = structuredClone(input);
  const normalized = normalize(input, { authorizeReference: (type) => type === "program" });

  assert.deepEqual(input, original);
  assert.equal(normalized.data.program.name, "Foundation");
  assert.equal(normalized.data.program.description, "");
  assert.equal(normalized.data.program.status, null);
  assert.equal(normalized.data.blocks[0].weeks[0].weekType, "normal");
  assert.equal(
    normalized.data.blocks[0].weeks[0].prescriptions[0].workout.components[0].targets.intensity
      .scale,
    "RPE",
  );
});

test("normalizes every published sample", () => {
  for (const name of [
    "import-v1-program.json",
    "import-v1-workout-results.json",
    "import-v1-daily-check-ins.json",
    "import-v1-heart-rate.json",
  ]) {
    assert.equal(normalize(sample(name)).version, 1);
  }
});

test("rejects stale object shapes and unknown nested keys", () => {
  assert.throws(() => normalize({ ...program(), version: 2 }), /Unsupported import version/);
  const unknown = program();
  unknown.data.blocks[0].weeks[0].prescriptions[0].workout.components[0].unknown = true;
  assert.throws(() => normalize(unknown), /unknown field/);
  const invalidRef = program();
  invalidRef.data.blocks[0].weeks[0].prescriptions[0].slotExternalId = "missing";
  assert.throws(() => normalize(invalidRef, { authorizeReference: () => true }), /unknown slot/);
});

test("rejects PocketBase identifiers without owner authorization", () => {
  assert.throws(() => normalize(program()), ImportValidationError);
  assert.throws(
    () => normalize(program(), { authorizeReference: () => false }),
    /Unauthorized program id/,
  );
});

test("rejects duplicate references to the same hierarchy record", () => {
  const input = program();
  input.data.blocks[0].slots.push({
    id: "same-slot-id",
    externalId: "thursday",
    weekday: 4,
    position: 2,
    label: "Strength",
  });
  input.data.blocks[0].slots[0].id = "same-slot-id";
  assert.throws(
    () => normalize(input, { authorizeReference: () => true }),
    /duplicate "same-slot-id"/,
  );
});

test("preserves planned and component ranges and rejects reversed endpoints", () => {
  const valid = sample("import-v1-program.json");
  const workout = valid.data.blocks[0].weeks[0].prescriptions[0].workout;
  workout.plannedDurationMin = 35;
  workout.plannedDurationMax = 40;
  workout.plannedRpeMin = 6;
  workout.plannedRpeMax = 7;
  workout.components[0].durationMin = 10;
  workout.components[0].durationMax = 12;
  workout.components[0].targets = {
    intensity: { min: 6, max: 7, scale: "RPE" },
  };
  const normalized = normalize(valid);
  const normalizedWorkout = normalized.data.blocks[0].weeks[0].prescriptions[0].workout;
  assert.equal(normalizedWorkout.plannedDurationMax, 40);
  assert.equal(normalizedWorkout.plannedRpeMin, 6);
  assert.equal(normalizedWorkout.plannedRpeMax, 7);
  assert.equal(normalizedWorkout.components[0].durationMax, 12);
  assert.deepEqual(normalizedWorkout.components[0].targets.intensity, {
    min: 6,
    max: 7,
    scale: "RPE",
  });

  workout.plannedDurationMax = 30;
  assert.throws(() => normalize(valid), /planned duration range/);
  workout.plannedDurationMax = 40;
  workout.plannedRpeMax = 5;
  assert.throws(() => normalize(valid), /planned RPE range/);
});

test("normalizes workout component results and validates dates", () => {
  const valid = envelope("workout-component-results", {
    sourceSessionId: "session-id",
    sourceWorkoutKey: "workout-1",
    completedDate: "2026-11-20",
    actualDurationMin: 45,
    sessionRpe: 7,
    notes: " Strong finish ",
    components: [
      {
        key: "hangs",
        plannedPosition: 1,
        name: "Hangs",
        completed: true,
        setsCompleted: 5,
        actualLoad: { value: 10, unit: "kg" },
        observation: {
          category: "knee_tracking",
          severity: "pronounced",
          context: "Heavy sets",
          notes: "Knee valgus",
        },
      },
    ],
  });
  const normalized = normalize(valid, {
    authorizeReference: (type, id) => type === "scheduled-session" && id === "session-id",
  });
  assert.equal(normalized.data.notes, "Strong finish");
  assert.equal(normalized.data.components[0].repsCompleted, null);
  assert.deepEqual(normalized.data.components[0].observation, {
    category: "knee_tracking",
    severity: "pronounced",
    context: "Heavy sets",
    notes: "Knee valgus",
  });
  assert.equal(normalized.data.replaceExistingCompletion, false);

  valid.data.replaceExistingCompletion = true;
  const withAuthorization = normalize(valid, {
    authorizeReference: (type, id) => type === "scheduled-session" && id === "session-id",
  });
  assert.equal(withAuthorization.data.replaceExistingCompletion, true);

  valid.data.completedDate = "2026-02-30";
  assert.throws(() => normalize(valid, { authorizeReference: () => true }), /completion date/);
});

test("normalizes daily check-ins to explicit null semantics and canonical date order", () => {
  const normalized = normalize(
    envelope("daily-check-ins", {
      entries: [
        { date: "2026-11-20", recovery: { sleepHours: 8 }, nutrition: {} },
        { date: "2026-11-19" },
      ],
    }),
  );
  assert.deepEqual(
    normalized.data.entries.map((entry) => entry.date),
    ["2026-11-19", "2026-11-20"],
  );
  assert.equal(normalized.data.entries[0].recovery.sleepHours, null);
  assert.equal(normalized.data.entries[0].nutrition.proteinGrams, null);

  assert.throws(
    () =>
      normalize(
        envelope("daily-check-ins", {
          entries: [{ date: "2026-11-20" }, { date: "2026-11-20" }],
        }),
      ),
    /duplicate/,
  );
});

test("normalizes heart-rate metadata and rejects invalid recording bounds", () => {
  const valid = envelope("heart-rate-recording", {
    sourceWorkoutKey: "workout-1",
    startedAt: "2026-11-20T17:00:00Z",
    endedAt: "2026-11-20T18:00:00Z",
    timezone: "Pacific/Kiritimati",
    units: "bpm",
    device: {},
    algorithm: { name: "Device" },
  });
  const normalized = normalize(valid);
  assert.equal(normalized.data.device.serial, null);
  assert.equal(normalized.data.algorithm.version, null);

  valid.data.endedAt = valid.data.startedAt;
  assert.throws(() => normalize(valid), /end must be after recording start/);

  valid.data.startedAt = "2026-02-30T17:00:00Z";
  valid.data.endedAt = "2026-03-01T17:00:00Z";
  assert.throws(() => normalize(valid), /recording start/);
});
