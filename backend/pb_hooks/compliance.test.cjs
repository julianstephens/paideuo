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
const { progression } = compile(path.join(__dirname, "gpp-progression.js"));

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
        {
          componentKey: "run",
          durationMin: 15,
          runningMin: 10,
          walkingMin: 5,
          aerobicModality: "run/walk",
        },
        { componentKey: "mobility", durationMin: 20 },
      ],
    },
  ];

  const total = calculate(sessions, "2026-01-10");
  assert.equal(total.aerobicMinutes, 15);
  assert.deepEqual(total.aerobicByModality, { "run/walk": 15 });
  assert.deepEqual(total.aerobicCoverage, { measured: 1, specified: 2 });
});

test("a later missing aerobic result does not add minutes or measured coverage", () => {
  const session = {
    status: "completed",
    planned: null,
    actual: null,
    prescription: { components: [{ key: "run", classification: "aerobic" }] },
  };
  const measured = { ...session, componentResults: [{ componentKey: "run", runningMin: 0 }] };
  const total = calculate([measured, session]);
  assert.equal(total.aerobicMinutes, 0);
  assert.equal(total.actualRunningMinutes, 0);
  assert.equal(total.actualWalkingMinutes, null);
  assert.deepEqual(total.aerobicCoverage, { measured: 1, specified: 2 });
  assert.equal(calculate([session]).aerobicMinutes, null);
});

test("GPP progression exposes generic planned and recorded outcomes", () => {
  const review = progression([
    {
      id: "session-1",
      scheduledDate: "2026-01-06",
      status: "completed",
      prescription: {
        title: "General preparation",
        components: [
          {
            key: "jog",
            name: "Jogging intervals",
            classification: "aerobic",
            targets: { work_seconds: 300, repetitions: 2 },
          },
          {
            key: "squat",
            name: "Front squat",
            classification: "strength",
            targets: {
              load: { value: 80, unit: "kg" },
              sets: 3,
              reps: "5",
              intensity: { value: 7, scale: "RPE" },
            },
          },
          {
            key: "circuit",
            name: "Conditioning circuit",
            classification: "other",
            targets: { repetitions: 4 },
          },
        ],
      },
      componentResults: [
        {
          componentKey: "jog",
          durationMin: 12,
          continuousBoutMin: 6,
          aerobicModality: "running",
        },
        {
          componentKey: "squat",
          load: { value: 75, unit: "kg" },
          sets: 3,
          reps: "5",
          rpe: 7,
        },
        { componentKey: "circuit", rounds: 3 },
      ],
    },
  ]);

  assert.equal(review.jogging[0].plannedBoutMin, 5);
  assert.equal(review.jogging[0].actualBoutMin, 6);
  assert.equal(review.frontSquat[0].plannedLoad.value, 80);
  assert.equal(review.frontSquat[0].actualLoad.value, 75);
  assert.equal(review.circuits[0].plannedRounds, 4);
  assert.equal(review.circuits[0].actualRounds, 3);
  assert.equal(review.aerobicByModality.running, 12);
  assert.equal(review.aerobicCoverage.measured, 1);
  assert.deepEqual(review.sourceSessions, [
    {
      id: "session-1",
      date: "2026-01-06",
      title: "General preparation",
      status: "completed",
    },
  ]);
});
