const collection = "paideuo_daily_recovery";
const preferenceField = "disabled_check_in_fields";

const numeric =
  (label, min, max, integer = true) =>
  (value) => {
    if (value == null) return null;
    if (
      !Number.isFinite(value) ||
      value < min ||
      value > max ||
      (integer && !Number.isSafeInteger(value))
    ) {
      throw new BadRequestError(`Enter a valid ${label}.`);
    }
    return value;
  };

const notes = (value) => {
  if (value == null) return "";
  if (typeof value !== "string" || value.length > 10000) {
    throw new BadRequestError("Notes must be 10,000 characters or fewer.");
  }
  return value.trim();
};

const choice = (label, values) => (value) => {
  if (value == null) return null;
  if (!values.includes(value)) throw new BadRequestError(`Choose a valid ${label}.`);
  return value;
};

const recovery = {
  sleepHours: numeric("sleep duration", 0, 24, false),
  sleepQuality: numeric("sleep quality from 1 to 5", 1, 5),
  fatigue: numeric("fatigue rating from 1 to 5", 1, 5),
  soreness: numeric("soreness rating from 1 to 5", 1, 5),
  readiness: numeric("readiness rating from 1 to 5", 1, 5),
  restingHeartRate: numeric("resting heart rate in whole BPM", 1, Number.MAX_SAFE_INTEGER),
  notes,
};
const nutrition = {
  nutritionAdequacy: choice("nutrition adequacy", ["adequate", "likely_insufficient", "unsure"]),
  trainingFueling: choice("training fueling", [
    "adequate",
    "inadequate",
    "not_applicable",
    "unsure",
  ]),
  calories: numeric("calorie intake", 0, Infinity, false),
  mealTiming: notes,
  skippedMeals: numeric("number of skipped meals", 0, Number.MAX_SAFE_INTEGER),
  morningWeightKg: numeric("morning body weight in kilograms", 0.01, Infinity, false),
  hunger: numeric("hunger rating from 1 to 5", 1, 5),
  digestion: numeric("digestion rating from 1 to 5", 1, 5),
  energy: numeric("energy rating from 1 to 5", 1, 5),
  trainingRecovery: numeric("training recovery rating from 1 to 5", 1, 5),
  proteinGrams: numeric("protein intake in grams", 0, Infinity, false),
  nutritionNotes: notes,
};
const fields = { ...recovery, ...nutrition };
const readJson = (record, key) => JSON.parse(record?.getString(key) || "null");
const disabledFields = (user) => {
  const value = readJson(user, preferenceField);
  return Array.isArray(value) ? value.filter((key) => Object.hasOwn(fields, key)) : [];
};

const blank = (validators) =>
  Object.fromEntries(Object.entries(validators).map(([key, validate]) => [key, validate(null)]));

const entryData = (record) => ({
  date: record.getString("date"),
  ...blank(fields),
  ...readJson(record, "measurements"),
  ...readJson(record, "nutrition"),
});

const list = (event, legacy) => {
  const { parse } = require(__hooks + "/calendar-dates.js");
  const query = event.request.url.query();
  const start = query.get("start");
  const end = query.get("end");
  const first = parse(start);
  const last = parse(end);
  if (!first || !last || last < first || last - first > 55 * 86_400_000) {
    throw new BadRequestError("Choose a valid check-in range of up to 56 days.");
  }
  const records = event.app.findRecordsByFilter(
    collection,
    "owner = {:owner} && date >= {:start} && date <= {:end}",
    "date",
    56,
    0,
    { owner: event.auth.id, start, end },
  );
  const entries = legacy
    ? records.flatMap((record) => {
        const measurements = readJson(record, "measurements");
        return measurements ? [{ date: record.getString("date"), ...measurements }] : [];
      })
    : records.map(entryData);
  return event.json(200, entries);
};

const merge = (current, validators, body, disabled) => {
  const changed = Object.entries(validators).filter(
    ([key]) => Object.hasOwn(body, key) && !disabled.includes(key),
  );
  if (!changed.length) return current;
  const next = { ...blank(validators), ...current };
  for (const [key, validate] of changed) next[key] = validate(body[key]);
  return Object.values(next).some((value) => value !== null && value !== "") ? next : null;
};

const write = (event, legacy) => {
  const { parse } = require(__hooks + "/calendar-dates.js");
  const date = event.request.pathValue("date");
  if (!parse(date)) throw new BadRequestError("Choose a valid check-in date.");

  const removing = event.request.method === "DELETE";
  const owner = event.auth.id;
  const body = removing ? {} : event.requestInfo().body;
  let result;
  event.app.runInTransaction((tx) => {
    const [record] = tx.findRecordsByFilter(
      collection,
      "owner = {:owner} && date = {:date}",
      "",
      1,
      0,
      { owner, date },
    );
    let measurements = readJson(record, "measurements");
    let nutritionData = readJson(record, "nutrition");
    if (legacy) {
      measurements = removing
        ? null
        : Object.fromEntries(
            Object.entries(recovery).map(([key, validate]) => [key, validate(body[key])]),
          );
    } else if (removing) {
      measurements = null;
      nutritionData = null;
    } else {
      const disabled = disabledFields(tx.findRecordById("paideuo_users", owner));
      measurements = merge(measurements, recovery, body, disabled);
      nutritionData = merge(nutritionData, nutrition, body, disabled);
    }

    if (!measurements && !nutritionData) {
      if (record) tx.delete(record);
      result = { date, ...blank(fields) };
      return;
    }
    const entry = record ?? new Record(tx.findCollectionByNameOrId(collection), { owner, date });
    entry.set("measurements", measurements);
    entry.set("nutrition", nutritionData);
    tx.save(entry);
    result = legacy ? { date, ...measurements } : entryData(entry);
  });

  return removing ? event.noContent(204) : event.json(200, result);
};

const metricKeys = [
  "duration",
  "load",
  "completion",
  "sleep",
  "fatigue",
  "soreness",
  "nutrition",
  "intensity",
];
const displayField = "metric_display_preferences";
const readPreferences = (user) => {
  const settings = readJson(user, displayField);
  return {
    disabled: disabledFields(user),
    hiddenCharts: settings?.hiddenCharts ?? [],
    hiddenSummary: settings?.hiddenSummary ?? [],
    durationUnit: settings?.durationUnit ?? "hours",
    calendarMacroTolerance: settings?.calendarMacroTolerance ?? {
      withinPercent: 7.5,
      warningPercent: 15,
    },
  };
};

const preferences = (event) => {
  const owner = event.auth.id;
  if (event.request.method === "GET") {
    return event.json(200, readPreferences(event.app.findRecordById("paideuo_users", owner)));
  }
  const {
    group = "disabled",
    key,
    keys = [key],
    enabled,
    durationUnit,
    calendarMacroTolerance,
  } = event.requestInfo().body;
  const allowedKeys =
    group === "disabled"
      ? Object.keys(fields)
      : [...metricKeys, ...require(__hooks + "/metrics.js").nutritionMetricKeys];
  if (group === "durationUnit") {
    if (durationUnit !== "hours" && durationUnit !== "minutes") {
      throw new BadRequestError("Choose hours or minutes.");
    }
  } else if (group === "calendarMacroTolerance") {
    const { withinPercent, warningPercent } = calendarMacroTolerance ?? {};
    if (
      !Number.isFinite(withinPercent) ||
      !Number.isFinite(warningPercent) ||
      withinPercent < 0 ||
      warningPercent <= withinPercent
    ) {
      throw new BadRequestError(
        "Enter nonnegative percentages with a warning limit above the within-range limit.",
      );
    }
  } else if (
    !["disabled", "hiddenCharts", "hiddenSummary"].includes(group) ||
    !Array.isArray(keys) ||
    keys.length === 0 ||
    keys.length > allowedKeys.length ||
    !keys.every((item) => allowedKeys.includes(item)) ||
    typeof enabled !== "boolean"
  ) {
    throw new BadRequestError("Choose a built-in metric and whether to show it.");
  }

  let result;
  event.app.runInTransaction((tx) => {
    const user = tx.findRecordById("paideuo_users", owner);
    result = readPreferences(user);
    if (group === "durationUnit") {
      result.durationUnit = durationUnit;
    } else if (group === "calendarMacroTolerance") {
      const { withinPercent, warningPercent } = calendarMacroTolerance;
      result.calendarMacroTolerance = { withinPercent, warningPercent };
    } else {
      const hidden = new Set(result[group]);
      for (const item of keys) {
        if (enabled) hidden.delete(item);
        else hidden.add(item);
      }
      result[group] = [...hidden];
    }
    const { disabled, ...display } = result;
    if (
      group !== "calendarMacroTolerance" &&
      !readJson(user, displayField)?.calendarMacroTolerance
    ) {
      delete display.calendarMacroTolerance;
    }
    user.set(preferenceField, disabled);
    user.set(displayField, display);
    tx.save(user);
  });
  return event.json(200, result);
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { list, write, preferences, entryData };
