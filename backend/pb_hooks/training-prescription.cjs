const sessionTypes = ["climbing", "strength", "conditioning", "mobility", "other", "rest"];

const isRestPrescription = (prescription) =>
  prescription?.sessionType === "rest" ||
  prescription?.kind === "rest" ||
  prescription?.type === "rest" ||
  prescription?.rest === true;

const isRest = (session) => session?.status === "rest" || isRestPrescription(session?.prescription);

const isOptional = (component) => component?.optional === true;

const requiredPlannedMinutes = (planned, prescription) => {
  if (planned == null) return null;
  const optionalMinutes = (prescription?.components ?? []).reduce(
    (total, component) =>
      isOptional(component) && Number.isFinite(component.durationMin)
        ? total + component.durationMin
        : total,
    0,
  );
  return Math.max(0, planned - optionalMinutes);
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { sessionTypes, isRestPrescription, isRest, isOptional, requiredPlannedMinutes };
