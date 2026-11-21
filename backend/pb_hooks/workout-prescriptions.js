const text = (value, label, max, required = false) => {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new BadRequestError(`Enter a valid ${label}.`);
  }
  return value.trim();
};

const parsePrescription = (prescription) => {
  if (!prescription || typeof prescription !== "object" || Array.isArray(prescription)) {
    throw new BadRequestError("Enter a valid workout prescription.");
  }
  const {
    title,
    sessionType,
    description = "",
    notes = "",
    plannedDurationMin = null,
    plannedDurationMax = null,
    plannedRpeMin = null,
    plannedRpeMax = null,
    plannedRpe = null,
    plannedIntensity = null,
    components = [],
  } = prescription;
  if (!["climbing", "strength", "conditioning", "mobility", "other"].includes(sessionType)) {
    throw new BadRequestError("Choose a session type.");
  }
  if (
    plannedDurationMin !== null &&
    (!Number.isSafeInteger(plannedDurationMin) || plannedDurationMin < 0)
  ) {
    throw new BadRequestError("Enter a nonnegative whole number of minutes or clear the duration.");
  }
  if (
    plannedDurationMax !== null &&
    (!Number.isSafeInteger(plannedDurationMax) || plannedDurationMax < 0)
  ) {
    throw new BadRequestError("Enter a nonnegative whole maximum duration or clear it.");
  }
  if (
    plannedDurationMax !== null &&
    plannedDurationMin !== null &&
    plannedDurationMax < plannedDurationMin
  ) {
    throw new BadRequestError(
      "Maximum duration must be greater than or equal to minimum duration.",
    );
  }
  const nestedRpe = plannedRpe && typeof plannedRpe === "object" ? plannedRpe : null;
  const rpeMin = plannedRpeMin ?? nestedRpe?.min ?? null;
  const rpeMax = plannedRpeMax ?? nestedRpe?.max ?? null;
  for (const value of [rpeMin, rpeMax]) {
    if (value !== null && (!Number.isFinite(value) || value < 1 || value > 10)) {
      throw new BadRequestError("Enter a session RPE from 1 to 10 or clear it.");
    }
  }
  if (rpeMin !== null && rpeMax !== null && rpeMax < rpeMin) {
    throw new BadRequestError("Maximum RPE must be greater than or equal to minimum RPE.");
  }
  if (
    plannedIntensity !== null &&
    !["easy", "moderate", "hard", "maximal"].includes(plannedIntensity)
  ) {
    throw new BadRequestError("Choose a planned intensity.");
  }
  const componentValues = require(__hooks + "/prescription-components.js");
  return {
    title: text(title, "title", 200, true),
    sessionType,
    description: text(description, "description", 10000),
    notes: text(notes, "notes", 10000),
    plannedDurationMin,
    plannedDurationMax,
    plannedRpeMin: rpeMin,
    plannedRpeMax: rpeMax,
    plannedIntensity,
    components: componentValues(components).map((component) => ({
      key: component.key,
      name: component.name,
      instructions: component.instructions,
      durationMin: component.duration_specified ? component.duration_min : null,
      durationMax: component.duration_max > 0 ? component.duration_max : null,
      classification: component.classification ?? null,
      targets: component.targets,
    })),
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = parsePrescription;
