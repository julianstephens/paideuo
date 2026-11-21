// oxlint-disable-next-line import/no-commonjs
module.exports = (components) => {
  if (!Array.isArray(components)) throw new BadRequestError("Enter a valid component list.");
  const parseTargets = require(__hooks + "/component-targets.js");
  const whole = (value) => Number.isSafeInteger(value) && value >= 0;
  const nonempty = (value, max) =>
    typeof value === "string" && !!value.trim() && value.trim().length <= max;
  const keys = new Set();

  return components.map((component, index) => {
    const position = index + 1;
    if (
      !component ||
      typeof component !== "object" ||
      Array.isArray(component) ||
      !nonempty(component.name, 200)
    ) {
      throw new BadRequestError(`Enter a name for component ${position}.`);
    }
    const instructions = component.instructions ?? "";
    const duration = component.durationMin;
    if (typeof instructions !== "string" || instructions.trim().length > 10000) {
      throw new BadRequestError(`Enter valid instructions for component ${position}.`);
    }
    if (duration != null && !whole(duration)) {
      throw new BadRequestError(`Enter a nonnegative whole duration for component ${position}.`);
    }
    const key = component.key ?? $security.randomString(24);
    if (
      typeof key !== "string" ||
      !/^[A-Za-z0-9:_-]{1,200}$/.test(key) ||
      keys.has(key)
    ) {
      throw new BadRequestError(`Enter valid unique identifiers for the workout components.`);
    }
    keys.add(key);
    return {
      key,
      position,
      name: component.name.trim(),
      instructions: instructions.trim(),
      duration_min: duration ?? 0,
      duration_specified: duration != null,
      targets: parseTargets(component.targets, position),
    };
  });
};
