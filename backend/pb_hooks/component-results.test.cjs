/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

global.BadRequestError = class BadRequestError extends Error {};
global.$security = {
  randomString: () => "generated-component-key",
};
global.__hooks = __dirname;

const compile = (filename, replacements = {}) => {
  const result = new Module(filename);
  result.filename = filename;
  result.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = Module.prototype.require.bind(result);
  result.require = (id) => replacements[id] ?? nativeRequire(id);
  result._compile(fs.readFileSync(filename, "utf8"), filename);
  return result.exports;
};
const { parseResults, resultData } = compile(path.join(__dirname, "component-results.js"));
const componentTargets = compile(path.join(__dirname, "component-targets.js"));
const prescriptionComponents = compile(path.join(__dirname, "prescription-components.js"), {
  [path.join(__dirname, "component-targets.js")]: componentTargets,
});
const parsePrescription = compile(path.join(__dirname, "workout-prescriptions.js"), {
  [path.join(__dirname, "prescription-components.js")]: prescriptionComponents,
});

const snapshot = {
  components: [
    { key: "front-squat", name: "Front squat" },
    { key: "row", name: "Row" },
  ],
};

test("component results preserve optional values independently", () => {
  assert.deepEqual(
    parseResults(
      [
        {
          componentKey: "front-squat",
          load: { value: 60, unit: "kg" },
          sets: 3,
          reps: "5",
          rpe: 6,
          notes: "Solid",
        },
      ],
      snapshot,
    ),
    [
      {
        componentKey: "front-squat",
        load: { value: 60, unit: "kg" },
        sets: 3,
        reps: "5",
        rpe: 6,
        durationMin: null,
        rounds: null,
        notes: "Solid",
      },
    ],
  );
});

test("component results must reference unique snapshot components", () => {
  assert.throws(
    () => parseResults([{ componentKey: "missing", notes: "" }], snapshot),
    /unique components in this workout/,
  );
  assert.throws(
    () =>
      parseResults([{ componentKey: "front-squat" }, { componentKey: "front-squat" }], snapshot),
    /unique components in this workout/,
  );
});

test("component result validation rejects invalid or partial values", () => {
  assert.throws(
    () => parseResults([{ componentKey: "front-squat", load: { value: 60, unit: "" } }], snapshot),
    /load and a unit/,
  );
  assert.throws(
    () => parseResults([{ componentKey: "front-squat", rpe: 11 }], snapshot),
    /RPE from 1 to 10/,
  );
});

test("result records expose missing values as null", () => {
  const record = {
    getString: (field) =>
      ({
        component_key: "front-squat",
        actual_load: "null",
        sets_completed: "null",
        reps_completed: "",
        rpe: "null",
        actual_duration_min: "null",
        rounds: "null",
        notes: "",
      })[field] ?? "",
  };
  assert.deepEqual(resultData(record), {
    componentKey: "front-squat",
    load: null,
    sets: null,
    reps: null,
    rpe: null,
    durationMin: null,
    rounds: null,
    notes: "",
  });
});

test("snapshot component keys are generated and preserved", () => {
  const fields = {
    title: "Strength",
    sessionType: "strength",
    components: [{ name: "Squat", instructions: "" }],
  };
  assert.equal(parsePrescription(fields).components[0].key, "generated-component-key");
  assert.equal(
    parsePrescription({
      ...fields,
      components: [{ ...fields.components[0], key: "existing-component-key" }],
    }).components[0].key,
    "existing-component-key",
  );
});

test("snapshot component identifiers are unique", () => {
  assert.throws(
    () =>
      parsePrescription({
        title: "Strength",
        sessionType: "strength",
        components: [
          { key: "same", name: "Squat" },
          { key: "same", name: "Press" },
        ],
      }),
    /unique identifiers/,
  );
});
