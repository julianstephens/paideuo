const completionCollection = "paideuo_session_completions";

const ownSession = (db, id, owner) => {
  const [row] = db.findRecordsByFilter(
    "paideuo_scheduled_sessions",
    "id = {:id} && schedule.program.owner = {:owner}",
    "",
    1,
    0,
    { id, owner },
  );
  if (!row) throw new NotFoundError("Scheduled session not found.");
  return row;
};

const completionData = (record) =>
  record
    ? {
        completedDate: record.getString("completed_date"),
        actualDurationMin: JSON.parse(record.getString("actual_duration_min") || "null"),
        sessionRpe: JSON.parse(record.getString("session_rpe") || "null"),
        notes: record.getString("notes"),
      }
    : null;

const state = (row, completion) => ({
  sessionLoad: require(__hooks + "/training-load.js").sessionLoad(completion),
  status: row.getString("status"),
  completion,
  revision: $security.sha256(
    JSON.stringify([
      row.getString("updated"),
      row.getString("scheduled_date"),
      row.getString("status"),
      row.getString("prescription_snapshot"),
      completion,
    ]),
  ),
});

// oxlint-disable-next-line import/no-commonjs
module.exports = { completionCollection, completionData, ownSession, state };
