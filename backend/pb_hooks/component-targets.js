// PocketBase loads shared hook modules through CommonJS.
// oxlint-disable-next-line import/no-commonjs
module.exports = (targets, position) => {
  if (targets == null) return null;
  const object = (value, keys) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => keys.includes(key));
  const nonnegative = (value) => Number.isFinite(value) && value >= 0;
  const whole = (value) => Number.isSafeInteger(value) && value >= 0;
  const nonempty = (value, max) =>
    typeof value === "string" && !!value.trim() && value.trim().length <= max;
  const validators = {
    sets: whole,
    reps: (value) => nonempty(value, 200),
    load: (value) =>
      object(value, ["value", "unit"]) && nonnegative(value.value) && nonempty(value.unit, 32),
    intensity: (value) =>
      object(value, ["value", "scale"]) &&
      value.scale === "RPE" &&
      Number.isFinite(value.value) &&
      value.value >= 1 &&
      value.value <= 10,
    grade: (value) =>
      object(value, ["min", "max"]) &&
      Object.keys(value).length > 0 &&
      Object.values(value).every((grade) => nonempty(grade, 64)),
    angle_degrees: nonnegative,
    work_seconds: whole,
    rest_seconds: whole,
    repetitions: whole,
    segments: (value) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every(
        (segment) =>
          object(segment, ["type", "duration_seconds"]) &&
          ["warmup", "work", "recovery", "cooldown"].includes(segment.type) &&
          whole(segment.duration_seconds),
      ),
  };
  if (!object(targets, Object.keys(validators))) {
    throw new BadRequestError(`Component ${position} contains an unknown or invalid target.`);
  }
  for (const [key, value] of Object.entries(targets)) {
    if (!validators[key](value))
      throw new BadRequestError(
        `Component ${position} has an invalid ${key.replaceAll("_", " ")} target.`,
      );
  }
  return Object.keys(targets).length ? targets : null;
};
