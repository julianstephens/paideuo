// oxlint-disable-next-line import/no-commonjs
module.exports = (components) => {
  if (!Array.isArray(components)) throw new BadRequestError("Enter a valid component list.");
  const { componentFields } = require(__hooks + "/prescription-fields.cjs");
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
    const durationMax = component.durationMax;
    if (typeof instructions !== "string" || instructions.trim().length > 10000) {
      throw new BadRequestError(`Enter valid instructions for component ${position}.`);
    }
    if (duration != null && !whole(duration)) {
      throw new BadRequestError(`Enter a nonnegative whole duration for component ${position}.`);
    }
    if (
      durationMax != null &&
      (!whole(durationMax) || (duration != null && durationMax < duration))
    ) {
      throw new BadRequestError(
        `Enter a duration range in ascending order for component ${position}.`,
      );
    }
    const suppliedKey = component.key ?? $security.randomString(24);
    if (!nonempty(suppliedKey, 200) || keys.has(suppliedKey.trim())) {
      throw new BadRequestError(`Enter valid unique identifiers for the workout components.`);
    }
    const key = suppliedKey.trim();
    keys.add(key);
    const classifications = ["aerobic", "strength", "movement", "mobility", "other"];
    const classification = component.classification ?? component.trainingClassification ?? null;
    if (classification !== null && !classifications.includes(classification)) {
      throw new BadRequestError(
        `Choose a valid training classification for component ${position}.`,
      );
    }
    if (component.optional != null && typeof component.optional !== "boolean") {
      throw new BadRequestError(`Choose a valid optional setting for component ${position}.`);
    }
    return componentFields(
      {
        key,
        name: component.name.trim(),
        instructions: instructions.trim(),
        classification,
        optional: component.optional === true,
        durationMin: duration,
        durationMax,
        targets: parseTargets(component.targets, position),
      },
      index,
    );
  });
};
