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

const nullableModality = (value) => {
  if (value == null || value === "") return null;
  return nullableText(value, 64, "Aerobic modality");
};

const resultObservation = (value) => {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestError("Enter a valid component observation or clear it.");
  }
  const allowed = ["category", "severity", "context", "notes"];
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new BadRequestError("Component observation contains an unknown field.");
  }
  if (
    typeof value.category !== "string" ||
    !value.category.trim() ||
    value.category.trim().length > 64
  ) {
    throw new BadRequestError("Component observation category must be 64 characters or fewer.");
  }
  if (!["none", "mild", "pronounced", "not_assessed"].includes(value.severity)) {
    throw new BadRequestError("Choose a valid component observation severity.");
  }
  if (value.context != null && (typeof value.context !== "string" || value.context.length > 200)) {
    throw new BadRequestError("Observation context must be 200 characters or fewer.");
  }
  if (value.notes != null && (typeof value.notes !== "string" || value.notes.length > 10000)) {
    throw new BadRequestError("Observation notes must be 10,000 characters or fewer.");
  }
  return {
    category: value.category.trim(),
    severity: value.severity,
    context: typeof value.context === "string" ? value.context.trim() : "",
    notes: typeof value.notes === "string" ? value.notes.trim() : "",
  };
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
  const { aerobicDurationError } = require(__hooks + "/import-schemas.js");
  const seen = new Set();
  const results = values.map((value, index) => {
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
      "runningMin",
      "walkingMin",
      "continuousBoutMin",
      "aerobicModality",
      "modality",
      "notes",
      "observation",
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
    const result = {
      componentKey: value.componentKey,
      load: resultLoad(value.load),
      sets: nullableWhole(value.sets, "number of sets"),
      reps: nullableText(value.reps, 200, "Component reps"),
      rpe: nullableRpe(value.rpe),
      durationMin: nullableWhole(value.durationMin, "duration in minutes"),
      rounds: nullableWhole(value.rounds, "number of rounds"),
      runningMin: nullableWhole(value.runningMin, "running minutes"),
      walkingMin: nullableWhole(value.walkingMin, "walking minutes"),
      continuousBoutMin: nullableWhole(value.continuousBoutMin, "continuous-bout minutes"),
      aerobicModality: nullableModality(value.aerobicModality ?? value.modality),
      notes: notes.trim(),
      observation: resultObservation(value.observation),
    };
    const error = aerobicDurationError(result);
    if (error) throw new BadRequestError(`${label}. ${error}`);
    return result;
  });
  return results.sort(
    (left, right) =>
      components.get(left.componentKey).position - components.get(right.componentKey).position,
  );
};

const resultData = (record) => {
  const load = JSON.parse(record.getString("actual_load") || "null");
  return {
    componentKey: record.getString("component_key"),
    load: load === null ? null : { value: load.value, unit: load.unit },
    sets: JSON.parse(record.getString("sets_completed") || "null"),
    reps: record.getString("reps_completed") || null,
    rpe: JSON.parse(record.getString("rpe") || "null"),
    durationMin: JSON.parse(record.getString("actual_duration_min") || "null"),
    rounds: JSON.parse(record.getString("rounds") || "null"),
    runningMin: JSON.parse(record.getString("running_min") || "null"),
    walkingMin: JSON.parse(record.getString("walking_min") || "null"),
    continuousBoutMin: JSON.parse(record.getString("continuous_bout_min") || "null"),
    aerobicModality: record.getString("aerobic_modality") || null,
    notes: record.getString("notes"),
    observation: JSON.parse(record.getString("observation") || "null"),
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { parseResults, resultData };
