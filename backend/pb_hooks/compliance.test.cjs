/* oxlint-disable import/no-commonjs */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const compile = (filename) => {
  const result = new Module(filename);
  result.filename = filename;
  result.paths = Module._nodeModulePaths(path.dirname(filename));
  result._compile(fs.readFileSync(filename, "utf8"), filename);
  return result.exports;
};
const { calculate } = compile(path.join(__dirname, "compliance.js"));

test("aerobic totals exclude missing component outcomes and aggregate by modality", () => {
  const sessions = [
    {
      status: "completed",
      scheduledDate: "2026-01-06",
      planned: 45,
      actual: 45,
      plannedIntensity: "moderate",
      prescription: {
        components: [
          { key: "run", name: "Run/walk", classification: "aerobic" },
          { key: "mobility", name: "Mobility", classification: "mobility" },
          { key: "missing", name: "Cycle", classification: "aerobic" },
        ],
      },
      componentResults: [
        { componentKey: "run", durationMin: 15, runningMin: 10, walkingMin: 5, aerobicModality: "run/walk" },
        { componentKey: "mobility", durationMin: 20 },
      ],
    },
  ];

  const total = calculate(sessions, "2026-01-10");
  assert.equal(total.aerobicMinutes, 15);
  assert.deepEqual(total.aerobicByModality, { "run/walk": 15 });
  assert.deepEqual(total.aerobicCoverage, { measured: 1, specified: 2 });
});
