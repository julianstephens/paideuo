const completionCollection = "paideuo_session_completions";
const componentResultCollection = "paideuo_workout_component_results";

const ownerFilter = (prefix = "") =>
  `((${prefix}schedule = '' && ${prefix}owner = {:owner}) || ${prefix}schedule.program.owner = {:owner})`;

const sessionSchedule = (db, row) => {
  const schedule = row.getString("schedule");
  return schedule ? db.findRecordById("paideuo_program_schedules", schedule) : row;
};

const ownSession = (db, id, owner) => {
  const [row] = db.findRecordsByFilter(
    "paideuo_scheduled_sessions",
    "id = {:id} && deleted = false && " + ownerFilter(),
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

const todayIn = (timezone, now = new DateTime()) =>
  now.time().in(new Timezone(timezone)).format("2006-01-02");

const statusFor = (row, today) => {
  const prescription = JSON.parse(row.getString("prescription_snapshot") || "{}");
  const { isRestPrescription } = require(__hooks + "/training-prescription.cjs");
  if (isRestPrescription(prescription)) return "rest";
  const status = row.getString("status");
  return status === "planned" && row.getString("scheduled_date") < today ? "skipped" : status;
};

const state = (row, completion, status = row.getString("status"), componentResults = []) => ({
  sessionLoad: require(__hooks + "/training-load.js").sessionLoad(
    completion,
    JSON.parse(row.getString("prescription_snapshot") || "{}"),
  ),
  status,
  completion,
  componentResults,
  revision: $security.sha256(
    JSON.stringify([
      row.getString("scheduled_date"),
      row.getBool("manually_moved"),
      row.getBool("manually_edited"),
      status,
      row.getString("prescription_snapshot"),
      completion,
      componentResults,
    ]),
  ),
});

// oxlint-disable-next-line import/no-commonjs
module.exports = {
  completionCollection,
  componentResultCollection,
  completionData,
  ownerFilter,
  ownSession,
  sessionSchedule,
  state,
  statusFor,
  todayIn,
};
