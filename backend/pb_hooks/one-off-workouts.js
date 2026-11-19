const text = (value, label, max, required = false) => {
  if (typeof value !== "string" || value.trim().length > max || (required && !value.trim())) {
    throw new BadRequestError(`Enter a valid ${label}.`);
  }
  return value.trim();
};

const parsePrescription = ({
  title,
  sessionType,
  description = "",
  notes = "",
  plannedDurationMin = null,
  plannedIntensity = null,
  components = [],
}) => {
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
      name: component.name,
      instructions: component.instructions,
      durationMin: component.duration_specified ? component.duration_min : null,
      targets: component.targets,
    })),
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = (event) => {
  const dates = require(__hooks + "/calendar-dates.js");
  const { scheduledDate, timezone, prescription, operationId } = event.requestInfo().body;
  if (!dates.parse(scheduledDate)) throw new BadRequestError("Choose a valid calendar date.");
  if (!dates.validTimezone(timezone)) throw new BadRequestError("Choose a valid IANA timezone.");
  if (
    typeof operationId !== "string" ||
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId)
  ) {
    throw new BadRequestError("A valid workout operation ID is required.");
  }
  if (!prescription || typeof prescription !== "object" || Array.isArray(prescription)) {
    throw new BadRequestError("Enter a valid workout prescription.");
  }
  const snapshot = parsePrescription(prescription);
  const requestHash = $security.sha256(JSON.stringify([scheduledDate, timezone, snapshot]));
  const owner = event.auth.id;
  let id;
  event.app.runInTransaction((tx) => {
    const collection = "paideuo_scheduled_sessions";
    const [existing] = tx.findRecordsByFilter(
      collection,
      "owner = {:owner} && operation_id = {:operationId}",
      "",
      1,
      0,
      { owner, operationId },
    );
    if (existing) {
      if (existing.getString("request_hash") !== requestHash) {
        throw new ApiError(409, "This workout was already saved. Reopen the form to add another.");
      }
      id = existing.id;
      return;
    }
    const row = new Record(tx.findCollectionByNameOrId(collection), {
      owner,
      timezone,
      operation_id: operationId,
      request_hash: requestHash,
      scheduled_date: scheduledDate,
      original_date: scheduledDate,
      slot_position: 1,
      prescription_snapshot: snapshot,
      status: "planned",
    });
    tx.save(row);
    id = row.id;
  });
  return event.json(200, { id });
};
