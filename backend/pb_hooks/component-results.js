const nullableWhole = (value, label) => {
  if (value == null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new BadRequestError(`Enter a nonnegative whole ${label} or clear it.`);
  }
  return value;
};

const nullableRpe = (value) => {
  if (value == null) return null;
  if (!Number.isFinite(value) || value < 1 || value > 10) {
    throw new BadRequestError("Enter a component RPE from 1 to 10 or clear it.");
  }
  return value;
};

const nullableText = (value, max, label) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) {
    throw new BadRequestError(`${label} must be ${max.toLocaleString()} characters or fewer.`);
  }
  return value.trim();
};

const resultLoad = (load) => {
  if (load == null) return null;
  if (
    !load ||
    typeof load !== "object" ||
    Array.isArray(load) ||
    Object.keys(load).some((key) => !["value", "unit"].includes(key)) ||
    !Number.isFinite(load.value) ||
    load.value < 0 ||
    typeof load.unit !== "string" ||
    !load.unit.trim() ||
    load.unit.trim().length > 32
  ) {
    throw new BadRequestError("Enter a nonnegative component load and a unit, or clear both.");
  }
  return { value: load.value, unit: load.unit.trim() };
};

const parseResults = (values, snapshot) => {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) throw new BadRequestError("Enter a valid component result list.");
  const components = new Map(
    (snapshot?.components ?? []).map((component, index) => [
      component.key,
      { component, position: index + 1 },
    ]),
  );
  const seen = new Set();
  return values.map((value, index) => {
    const label = `Component result ${index + 1}`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestError(`Enter a valid ${label.toLowerCase()}.`);
    }
    const allowed = [
      "componentKey",
      "load",
      "sets",
      "reps",
      "rpe",
      "durationMin",
      "rounds",
      "notes",
    ];
    if (Object.keys(value).some((key) => !allowed.includes(key))) {
      throw new BadRequestError(`${label} contains an unknown field.`);
    }
    if (!components.has(value.componentKey) || seen.has(value.componentKey)) {
      throw new BadRequestError(
        "Component results must identify unique components in this workout.",
      );
    }
    seen.add(value.componentKey);
    const notes = value.notes ?? "";
    if (typeof notes !== "string" || notes.trim().length > 10000) {
      throw new BadRequestError("Component notes must be 10,000 characters or fewer.");
    }
    return {
      componentKey: value.componentKey,
      load: resultLoad(value.load),
      sets: nullableWhole(value.sets, "number of sets"),
      reps: nullableText(value.reps, 200, "Component reps"),
      rpe: nullableRpe(value.rpe),
      durationMin: nullableWhole(value.durationMin, "duration in minutes"),
      rounds: nullableWhole(value.rounds, "number of rounds"),
      notes: notes.trim(),
    };
  });
};

const resultData = (record) => ({
  componentKey: record.getString("component_key"),
  load: JSON.parse(record.getString("actual_load") || "null"),
  sets: JSON.parse(record.getString("sets_completed") || "null"),
  reps: record.getString("reps_completed") || null,
  rpe: JSON.parse(record.getString("rpe") || "null"),
  durationMin: JSON.parse(record.getString("actual_duration_min") || "null"),
  rounds: JSON.parse(record.getString("rounds") || "null"),
  notes: record.getString("notes"),
});

// oxlint-disable-next-line import/no-commonjs
module.exports = { parseResults, resultData };
