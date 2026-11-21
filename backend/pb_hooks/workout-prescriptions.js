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
    plannedIntensity,
    components: componentValues(components).map((component) => ({
      key: component.key,
      name: component.name,
      instructions: component.instructions,
      durationMin: component.duration_specified ? component.duration_min : null,
      targets: component.targets,
    })),
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = parsePrescription;
