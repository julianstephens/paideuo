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
  const snapshot = require(__hooks + "/workout-prescriptions.js")(prescription);
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
