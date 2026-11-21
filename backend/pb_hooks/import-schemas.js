const VERSION = 1;
const limits = Object.freeze({
  blocks: 100,
  components: 100,
  dailyEntries: 366,
  externalId: 200,
  resultComponents: 100,
  slots: 64,
  weeks: 520,
});

class ImportValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ImportValidationError";
  }
}

const fail = (message) => {
  if (typeof BadRequestError === "function") throw new BadRequestError(message);
  throw new ImportValidationError(message);
};

const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const plain = (value) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const object = (value, allowed, required, label) => {
  if (!plain(value)) fail(`Enter a valid ${label}.`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) fail(`${label} contains unknown field "${key}".`);
  }
  for (const key of required) {
    if (!has(value, key)) fail(`${label} is missing required field "${key}".`);
  }
  return value;
};

const list = (value, maximum, label) => {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (value.length > maximum) fail(`${label} must contain at most ${maximum} items.`);
  return value;
};

const text = (value, label, maximum, required = false) => {
  if (
    typeof value !== "string" ||
    value.length > maximum ||
    (required && value.trim().length === 0)
  ) {
    fail(`Enter a valid ${label}.`);
  }
  return value.trim();
};

const optionalText = (value, label, maximum) =>
  value == null ? null : text(value, label, maximum, false);

const choice = (value, values, label, nullable = false) => {
  if (nullable && value == null) return null;
  if (!values.includes(value)) fail(`Choose a valid ${label}.`);
  return value;
};

const whole = (value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER, nullable = false) => {
  if (nullable && value == null) return null;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(`Enter a valid ${label}.`);
  }
  return value;
};

const finite = (value, label, minimum, maximum, nullable = false) => {
  if (nullable && value == null) return null;
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    fail(`Enter a valid ${label}.`);
  }
  return value;
};

const aerobicDurationError = ({ durationMin, runningMin, walkingMin, continuousBoutMin }) => {
  if (durationMin != null && (runningMin ?? 0) + (walkingMin ?? 0) > durationMin) {
    return "Running and walking minutes together must fit within the elapsed component duration.";
  }
  const boutLimit = runningMin ?? durationMin ?? walkingMin;
  if (continuousBoutMin != null && boutLimit != null && continuousBoutMin > boutLimit) {
    return "The longest continuous bout must fit within the running or component duration.";
  }
  return null;
};

const civilDate = (value, label) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000")) {
    fail(`Enter a valid ${label}.`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    fail(`Enter a valid ${label}.`);
  }
  return value;
};

const timestamp = (value, label) => {
  if (typeof value !== "string") fail(`Enter a valid ${label}.`);
  const match =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (
    !match ||
    Number(match[2]) > 23 ||
    Number(match[3]) > 59 ||
    Number(match[4]) > 59 ||
    Number(match[5] ?? 0) > 23 ||
    Number(match[6] ?? 0) > 59
  ) {
    fail(`Enter a valid ${label}.`);
  }
  civilDate(match[1], label);
  if (!Number.isFinite(Date.parse(value))) fail(`Enter a valid ${label}.`);
  return value;
};

const timezone = (value, context) => {
  const label = text(value, "timezone", 100, true);
  if (context.validTimezone) {
    if (context.validTimezone(label) !== true) fail("Enter a valid timezone.");
    return label;
  }
  try {
    if (typeof Timezone === "function") {
      if (new Timezone(label).string() !== label) fail("Enter a valid timezone.");
    } else {
      new Intl.DateTimeFormat("en", { timeZone: label }).format();
    }
  } catch {
    fail("Enter a valid timezone.");
  }
  return label;
};

const unique = (items, getKey, label) => {
  const seen = new Set();
  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) fail(`${label} must not contain duplicate "${key}".`);
    seen.add(key);
  }
};

const authorize = (value, type, label, context) => {
  if (value == null || value === "") return null;
  const id = text(value, label, 100, true);
  if (typeof context.authorizeReference !== "function" || !context.authorizeReference(type, id)) {
    fail(`Unauthorized ${label}.`);
  }
  return id;
};

const externalId = (value, label) => text(value, label, limits.externalId, true);

const targets = (value, label) => {
  if (value == null) return null;
  const fields = object(
    value,
    [
      "sets",
      "reps",
      "load",
      "intensity",
      "grade",
      "angle_degrees",
      "work_seconds",
      "rest_seconds",
      "repetitions",
      "segments",
    ],
    [],
    label,
  );
  const normalized = {};
  if (has(fields, "sets")) normalized.sets = whole(fields.sets, `${label} sets`);
  if (has(fields, "reps")) normalized.reps = text(fields.reps, `${label} reps`, 200, true);
  if (has(fields, "load")) {
    const load = object(fields.load, ["value", "unit"], ["value", "unit"], `${label} load`);
    normalized.load = {
      value: finite(load.value, `${label} load value`, 0, Number.MAX_VALUE),
      unit: text(load.unit, `${label} load unit`, 32, true),
    };
  }
  if (has(fields, "intensity")) {
    const intensity = object(
      fields.intensity,
      ["value", "scale"],
      ["value", "scale"],
      `${label} intensity`,
    );
    normalized.intensity = {
      value: finite(intensity.value, `${label} intensity value`, 1, 10),
      scale: choice(intensity.scale, ["RPE"], `${label} intensity scale`),
    };
  }
  if (has(fields, "grade")) {
    const grade = object(fields.grade, ["min", "max"], [], `${label} grade`);
    if (!Object.keys(grade).length) fail(`${label} grade must contain min or max.`);
    normalized.grade = {};
    if (has(grade, "min"))
      normalized.grade.min = text(grade.min, `${label} minimum grade`, 64, true);
    if (has(grade, "max"))
      normalized.grade.max = text(grade.max, `${label} maximum grade`, 64, true);
  }
  if (has(fields, "angle_degrees")) {
    normalized.angle_degrees = finite(fields.angle_degrees, `${label} angle`, 0, Number.MAX_VALUE);
  }
  if (has(fields, "work_seconds")) {
    normalized.work_seconds = whole(fields.work_seconds, `${label} work duration`);
  }
  if (has(fields, "rest_seconds")) {
    normalized.rest_seconds = whole(fields.rest_seconds, `${label} rest duration`);
  }
  if (has(fields, "repetitions")) {
    normalized.repetitions = whole(fields.repetitions, `${label} repetitions`);
  }
  if (has(fields, "segments")) {
    if (!Array.isArray(fields.segments) || !fields.segments.length) {
      fail(`${label} segments must be a nonempty array.`);
    }
    normalized.segments = fields.segments.map((value, index) => {
      const segmentLabel = `${label} segment ${index + 1}`;
      const segment = object(
        value,
        ["type", "duration_seconds", "modality"],
        ["type", "duration_seconds"],
        segmentLabel,
      );
      return {
        type: choice(
          segment.type,
          ["warmup", "work", "recovery", "cooldown"],
          `${segmentLabel} type`,
        ),
        duration_seconds: whole(segment.duration_seconds, `${segmentLabel} duration in seconds`),
        ...(has(segment, "modality")
          ? {
              modality: choice(
                segment.modality,
                ["running", "walking"],
                `${segmentLabel} modality`,
              ),
            }
          : {}),
      };
    });
  }
  return Object.keys(normalized).length ? normalized : null;
};

const component = (value, index) => {
  const label = `component ${index + 1}`;
  const fields = object(
    value,
    ["key", "name", "instructions", "durationMin", "classification", "targets"],
    ["name"],
    label,
  );
  return {
    ...(fields.key == null ? {} : { key: externalId(fields.key, `${label} key`) }),
    name: text(fields.name, `${label} name`, 200, true),
    instructions: text(fields.instructions ?? "", `${label} instructions`, 10000),
    durationMin: whole(fields.durationMin, `${label} duration`, 0, Number.MAX_SAFE_INTEGER, true),
    classification:
      fields.classification == null
        ? null
        : ["aerobic", "strength", "movement", "mobility", "other"].includes(fields.classification)
          ? fields.classification
          : fail(`${label} classification is invalid.`),
    targets: targets(fields.targets, `${label} targets`),
  };
};

const prescription = (value, index) => {
  const label = `prescription ${index + 1}`;
  const fields = object(
    value,
    [
      "title",
      "sessionType",
      "description",
      "notes",
      "plannedDurationMin",
      "plannedIntensity",
      "components",
    ],
    ["title", "sessionType"],
    label,
  );
  const normalizedComponents = list(
    fields.components ?? [],
    limits.components,
    `${label} components`,
  ).map(component);
  unique(
    normalizedComponents.map((item, index) => item.key ?? `component-${index + 1}`),
    (key) => key,
    `${label} component keys`,
  );
  return {
    title: text(fields.title, `${label} title`, 200, true),
    sessionType: choice(
      fields.sessionType,
      ["climbing", "strength", "conditioning", "mobility", "other"],
      "session type",
    ),
    description: text(fields.description ?? "", `${label} description`, 10000),
    notes: text(fields.notes ?? "", `${label} notes`, 10000),
    plannedDurationMin: whole(
      fields.plannedDurationMin,
      `${label} planned duration`,
      0,
      Number.MAX_SAFE_INTEGER,
      true,
    ),
    plannedIntensity: choice(
      fields.plannedIntensity,
      ["easy", "moderate", "hard", "maximal"],
      "planned intensity",
      true,
    ),
    components: normalizedComponents,
  };
};

const normalizeProgram = (value, context) => {
  const data = object(value, ["program", "blocks"], ["program", "blocks"], "program import data");
  const identity = object(
    data.program,
    ["id", "externalId", "name", "description", "objective", "status"],
    ["externalId", "name"],
    "program",
  );
  const normalizedBlocks = list(data.blocks, limits.blocks, "program blocks").map(
    (rawBlock, blockIndex) => {
      const block = object(
        rawBlock,
        ["id", "externalId", "name", "objective", "position", "durationWeeks", "slots", "weeks"],
        ["externalId", "name", "position", "durationWeeks", "slots", "weeks"],
        `block ${blockIndex + 1}`,
      );
      const duration = whole(block.durationWeeks, "block duration", 1, limits.weeks);
      const slots = list(block.slots, limits.slots, "block slots").map((rawSlot, slotIndex) => {
        const slot = object(
          rawSlot,
          ["id", "externalId", "weekday", "position", "label"],
          ["externalId", "weekday", "position", "label"],
          `slot ${slotIndex + 1}`,
        );
        return {
          id: authorize(slot.id, "session-slot", "slot id", context),
          externalId: externalId(slot.externalId, "slot external ID"),
          weekday: whole(slot.weekday, "slot weekday", 1, 7),
          position: whole(slot.position, "slot position", 1),
          label: text(slot.label, "slot label", 200, true),
        };
      });
      const slotIds = new Set(slots.map((slot) => slot.externalId));
      unique(slots, (slot) => slot.externalId, "block slots");
      unique(slots, (slot) => slot.position, "block slots");
      unique(
        slots.filter((slot) => slot.id),
        (slot) => slot.id,
        "block slot IDs",
      );
      const weeks = list(block.weeks, duration, "block weeks").map((rawWeek, weekIndex) => {
        const week = object(
          rawWeek,
          ["id", "externalId", "position", "label", "focus", "weekType", "prescriptions"],
          ["externalId", "position", "weekType", "prescriptions"],
          `week ${weekIndex + 1}`,
        );
        const prescriptions = list(week.prescriptions, limits.slots, "week prescriptions").map(
          (rawPrescription, prescriptionIndex) => {
            const item = object(
              rawPrescription,
              ["slotExternalId", "workout"],
              ["slotExternalId", "workout"],
              `week prescription ${prescriptionIndex + 1}`,
            );
            const ref = externalId(item.slotExternalId, "prescription slot external ID");
            if (!slotIds.has(ref)) fail(`Prescription references unknown slot "${ref}".`);
            return { slotExternalId: ref, workout: prescription(item.workout, prescriptionIndex) };
          },
        );
        unique(prescriptions, (item) => item.slotExternalId, "week prescriptions");
        return {
          id: authorize(week.id, "program-week", "week id", context),
          externalId: externalId(week.externalId, "week external ID"),
          position: whole(week.position, "week position", 1, duration),
          label: text(week.label ?? "", "week label", 10000),
          focus: text(week.focus ?? "", "week focus", 10000),
          weekType: choice(week.weekType, ["normal", "recovery"], "week type"),
          prescriptions,
        };
      });
      if (weeks.length !== duration) fail("A block must define every week in its duration.");
      unique(weeks, (week) => week.externalId, "block weeks");
      unique(weeks, (week) => week.position, "block weeks");
      unique(
        weeks.filter((week) => week.id),
        (week) => week.id,
        "block week IDs",
      );
      return {
        id: authorize(block.id, "program-block", "block id", context),
        externalId: externalId(block.externalId, "block external ID"),
        name: text(block.name, "block name", 200, true),
        objective: text(block.objective ?? "", "block objective", 10000),
        position: whole(block.position, "block position", 1),
        durationWeeks: duration,
        slots,
        weeks,
      };
    },
  );
  const weekCount = normalizedBlocks.reduce((total, block) => total + block.weeks.length, 0);
  if (weekCount > limits.weeks) fail(`Program must contain at most ${limits.weeks} weeks.`);
  unique(normalizedBlocks, (block) => block.externalId, "program blocks");
  unique(normalizedBlocks, (block) => block.position, "program blocks");
  unique(
    normalizedBlocks.filter((block) => block.id),
    (block) => block.id,
    "program block IDs",
  );
  unique(
    normalizedBlocks.flatMap((block) => block.slots).filter((slot) => slot.id),
    (slot) => slot.id,
    "program slot IDs",
  );
  unique(
    normalizedBlocks.flatMap((block) => block.weeks).filter((week) => week.id),
    (week) => week.id,
    "program week IDs",
  );
  return {
    program: {
      id: authorize(identity.id, "program", "program id", context),
      externalId: externalId(identity.externalId, "program external ID"),
      name: text(identity.name, "program name", 200, true),
      objective: text(identity.objective ?? "", "program objective", 10000),
      description: text(identity.description ?? "", "program description", 10000),
      status: choice(
        identity.status,
        ["draft", "active", "completed", "archived"],
        "program status",
        true,
      ),
    },
    blocks: normalizedBlocks,
  };
};

const normalizeWorkoutResults = (value, context) => {
  const data = object(
    value,
    [
      "sourceSessionId",
      "sourceWorkoutKey",
      "completedDate",
      "actualDurationMin",
      "sessionRpe",
      "notes",
      "components",
      "replaceExistingCompletion",
    ],
    ["sourceWorkoutKey", "completedDate", "components"],
    "workout component result data",
  );
  const components = list(data.components, limits.resultComponents, "result components").map(
    (value, index) => {
      const label = `result component ${index + 1}`;
      const item = object(
        value,
        [
          "key",
          "plannedPosition",
          "name",
          "completed",
          "actualDurationMin",
          "setsCompleted",
          "repsCompleted",
          "actualLoad",
          "rpe",
          "rounds",
          "runningMin",
          "walkingMin",
          "continuousBoutMin",
          "aerobicModality",
          "notes",
        ],
        ["key", "plannedPosition", "name", "completed"],
        label,
      );
      const load =
        item.actualLoad == null
          ? null
          : object(item.actualLoad, ["value", "unit"], ["value", "unit"], `${label} actual load`);
      const result = {
        key: externalId(item.key, `${label} key`),
        plannedPosition: whole(item.plannedPosition, `${label} planned position`, 1),
        name: text(item.name, `${label} name`, 200, true),
        completed:
          typeof item.completed === "boolean"
            ? item.completed
            : fail(`${label} completion is invalid.`),
        actualDurationMin: whole(
          item.actualDurationMin,
          `${label} actual duration`,
          0,
          Number.MAX_SAFE_INTEGER,
          true,
        ),
        setsCompleted: whole(
          item.setsCompleted,
          `${label} completed sets`,
          0,
          Number.MAX_SAFE_INTEGER,
          true,
        ),
        repsCompleted: optionalText(item.repsCompleted, `${label} completed reps`, 200),
        actualLoad: load
          ? {
              value: finite(load.value, `${label} load value`, 0, Number.MAX_VALUE),
              unit: text(load.unit, `${label} load unit`, 32, true),
            }
          : null,
        rpe: finite(item.rpe, `${label} RPE`, 1, 10, true),
        rounds: whole(item.rounds, `${label} rounds`, 0, Number.MAX_SAFE_INTEGER, true),
        runningMin: whole(
          item.runningMin,
          `${label} running minutes`,
          0,
          Number.MAX_SAFE_INTEGER,
          true,
        ),
        walkingMin: whole(
          item.walkingMin,
          `${label} walking minutes`,
          0,
          Number.MAX_SAFE_INTEGER,
          true,
        ),
        continuousBoutMin: whole(
          item.continuousBoutMin,
          `${label} continuous-bout minutes`,
          0,
          Number.MAX_SAFE_INTEGER,
          true,
        ),
        aerobicModality: optionalText(item.aerobicModality, `${label} aerobic modality`, 64),
        notes: text(item.notes ?? "", `${label} notes`, 10000),
      };
      const error = aerobicDurationError({ ...result, durationMin: result.actualDurationMin });
      if (error) fail(`${label}. ${error}`);
      return result;
    },
  );
  unique(components, (item) => item.key, "result components");
  unique(components, (item) => item.plannedPosition, "result components");
  return {
    sourceSessionId: authorize(
      data.sourceSessionId,
      "scheduled-session",
      "scheduled session id",
      context,
    ),
    sourceWorkoutKey: externalId(data.sourceWorkoutKey, "source workout key"),
    completedDate: civilDate(data.completedDate, "completion date"),
    actualDurationMin: whole(
      data.actualDurationMin,
      "actual duration",
      0,
      Number.MAX_SAFE_INTEGER,
      true,
    ),
    sessionRpe: finite(data.sessionRpe, "session RPE", 1, 10, true),
    notes: text(data.notes ?? "", "workout notes", 10000),
    components,
    replaceExistingCompletion:
      data.replaceExistingCompletion === undefined
        ? false
        : typeof data.replaceExistingCompletion === "boolean"
          ? data.replaceExistingCompletion
          : fail("historical replacement authorization is invalid."),
  };
};

const normalizeDailyCheckIns = (value) => {
  const data = object(value, ["entries"], ["entries"], "daily check-in data");
  const entries = list(data.entries, limits.dailyEntries, "daily check-in entries").map(
    (value, index) => {
      const label = `daily check-in ${index + 1}`;
      const entry = object(value, ["date", "recovery", "nutrition"], ["date"], label);
      const recovery = object(
        entry.recovery ?? {},
        [
          "sleepHours",
          "sleepQuality",
          "fatigue",
          "soreness",
          "readiness",
          "restingHeartRate",
          "notes",
        ],
        [],
        `${label} recovery`,
      );
      const nutrition = object(
        entry.nutrition ?? {},
        ["nutritionAdequacy", "trainingFueling", "proteinGrams", "nutritionNotes"],
        [],
        `${label} nutrition`,
      );
      return {
        date: civilDate(entry.date, "check-in date"),
        recovery: {
          sleepHours: finite(recovery.sleepHours, "sleep duration", 0, 24, true),
          sleepQuality: whole(recovery.sleepQuality, "sleep quality", 1, 5, true),
          fatigue: whole(recovery.fatigue, "fatigue rating", 1, 5, true),
          soreness: whole(recovery.soreness, "soreness rating", 1, 5, true),
          readiness: whole(recovery.readiness, "readiness rating", 1, 5, true),
          restingHeartRate: whole(
            recovery.restingHeartRate,
            "resting heart rate",
            1,
            Number.MAX_SAFE_INTEGER,
            true,
          ),
          notes: text(recovery.notes ?? "", "recovery notes", 10000),
        },
        nutrition: {
          nutritionAdequacy: choice(
            nutrition.nutritionAdequacy,
            ["adequate", "likely_insufficient", "unsure"],
            "nutrition adequacy",
            true,
          ),
          trainingFueling: choice(
            nutrition.trainingFueling,
            ["adequate", "inadequate", "not_applicable", "unsure"],
            "training fueling",
            true,
          ),
          proteinGrams: finite(nutrition.proteinGrams, "protein intake", 0, Number.MAX_VALUE, true),
          nutritionNotes: text(nutrition.nutritionNotes ?? "", "nutrition notes", 10000),
        },
      };
    },
  );
  unique(entries, (entry) => entry.date, "daily check-in entries");
  entries.sort((left, right) => left.date.localeCompare(right.date));
  return { entries };
};

const normalizeHeartRateRecording = (value, context) => {
  const data = object(
    value,
    [
      "sourceSessionId",
      "sourceWorkoutKey",
      "startedAt",
      "endedAt",
      "timezone",
      "device",
      "provider",
      "externalId",
      "sampleIntervalSeconds",
      "sampleCount",
      "units",
      "algorithm",
    ],
    ["sourceWorkoutKey", "startedAt", "endedAt", "timezone", "units"],
    "heart-rate recording data",
  );
  const device = object(
    data.device ?? {},
    ["manufacturer", "model", "serial"],
    [],
    "heart-rate device",
  );
  const algorithm = object(data.algorithm ?? {}, ["name", "version"], [], "heart-rate algorithm");
  const startedAt = timestamp(data.startedAt, "recording start");
  const endedAt = timestamp(data.endedAt, "recording end");
  if (Date.parse(endedAt) <= Date.parse(startedAt)) {
    fail("Recording end must be after recording start.");
  }
  return {
    sourceSessionId: authorize(
      data.sourceSessionId,
      "scheduled-session",
      "scheduled session id",
      context,
    ),
    sourceWorkoutKey: externalId(data.sourceWorkoutKey, "source workout key"),
    startedAt,
    endedAt,
    timezone: timezone(data.timezone, context),
    device: {
      manufacturer: optionalText(device.manufacturer, "device manufacturer", 200),
      model: optionalText(device.model, "device model", 200),
      serial: optionalText(device.serial, "device serial", 200),
    },
    provider: optionalText(data.provider, "recording provider", 200),
    externalId: optionalText(data.externalId, "recording external ID", 200),
    sampleIntervalSeconds: finite(
      data.sampleIntervalSeconds,
      "sample interval",
      0,
      Number.MAX_VALUE,
      true,
    ),
    sampleCount: whole(data.sampleCount, "sample count", 0, Number.MAX_SAFE_INTEGER, true),
    units: choice(data.units, ["bpm"], "heart-rate units"),
    algorithm: {
      name: optionalText(algorithm.name, "algorithm name", 200),
      version: optionalText(algorithm.version, "algorithm version", 200),
    },
  };
};

const normalizers = {
  program: normalizeProgram,
  "workout-component-results": normalizeWorkoutResults,
  "daily-check-ins": normalizeDailyCheckIns,
  "heart-rate-recording": normalizeHeartRateRecording,
};

const normalize = (value, context = {}) => {
  const envelope = object(
    value,
    ["schema", "version", "kind", "data"],
    ["schema", "version", "kind", "data"],
    "import envelope",
  );
  if (envelope.schema !== "paideuo") fail('Import schema must be "paideuo".');
  if (envelope.version !== VERSION) fail(`Unsupported import version "${envelope.version}".`);
  if (!has(normalizers, envelope.kind)) fail("Choose a valid import kind.");
  return {
    schema: "paideuo",
    version: VERSION,
    kind: envelope.kind,
    data: normalizers[envelope.kind](envelope.data, context),
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = {
  ImportValidationError,
  aerobicDurationError,
  limits,
  normalize,
};
