const completionCollection = "paideuo_session_completions";

const ownerFilter = (prefix = "") =>
  `((${prefix}schedule = '' && ${prefix}owner = {:owner}) || ${prefix}schedule.program.owner = {:owner})`;

const sessionSchedule = (db, row) => {
  const schedule = row.getString("schedule");
  return schedule ? db.findRecordById("paideuo_program_schedules", schedule) : row;
};

const ownSession = (db, id, owner) => {
  const [row] = db.findRecordsByFilter(
    "paideuo_scheduled_sessions",
    "id = {:id} && " + ownerFilter(),
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
module.exports = {
  completionCollection,
  completionData,
  ownerFilter,
  ownSession,
  sessionSchedule,
  state,
};
