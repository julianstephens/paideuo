const todayFor = (schedule) =>
  require(__hooks + "/calendar-sessions.js").todayIn(schedule.getString("timezone"));

const snapshot = (row) => JSON.parse(row.getString("prescription_snapshot"));

const canonical = (value) => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
};
const serialize = (value) => JSON.stringify(canonical(value));

const blockedReason = (row, today) => {
  if (row.getString("status") !== "planned") return "Completed and skipped sessions are protected.";
  if (row.getString("scheduled_date") < today) return "Past calendar dates are protected.";
  return null;
};

const isProtected = (row, today) => Boolean(blockedReason(row, today));

const compare = (rows, desired, today) => {
  const current = new Map(rows.map((row) => [row.getString("source_prescription_id"), row]));
  const candidates = new Map(desired.map((item) => [item.sourcePrescriptionId, item]));
  const changes = [];
  for (const [id, after] of candidates) {
    const row = current.get(id);
    // A deleted occurrence still reserves its source within this schedule.
    if (row?.getBool("deleted")) continue;
    if (!row) {
      changes.push({
        id,
        kind: "add",
        before: null,
        after,
        blockedReason: after.scheduledDate < today ? "Past calendar dates are protected." : null,
      });
      continue;
    }

    const before = {
      scheduledDate: row.getString("scheduled_date"),
      slotPosition: row.getInt("slot_position"),
      prescription: snapshot(row),
    };
    const programDate = after.scheduledDate;
    const manuallyMoved = row.getBool("manually_moved");
    const effective = {
      ...after,
      scheduledDate: manuallyMoved ? before.scheduledDate : programDate,
      prescription: row.getBool("manually_edited") ? before.prescription : after.prescription,
    };
    if (
      programDate === row.getString("program_date") &&
      before.slotPosition === effective.slotPosition &&
      serialize(before.prescription) === serialize(effective.prescription) &&
      !row.getBool("source_removal_acknowledged")
    )
      continue;
    changes.push({
      id,
      kind: "update",
      before,
      after: effective,
      programDate,
      manuallyMoved,
      blockedReason:
        blockedReason(row, today) ||
        (effective.scheduledDate < today ? "The revised date would be in the past." : null),
    });
  }
  for (const [id, row] of current) {
    if (candidates.has(id) || row.getBool("deleted") || row.getBool("source_removal_acknowledged"))
      continue;
    changes.push({
      id,
      kind: row.getBool("manually_moved") ? "keep-moved" : "remove",
      before: {
        scheduledDate: row.getString("scheduled_date"),
        slotPosition: row.getInt("slot_position"),
        prescription: snapshot(row),
      },
      after: null,
      blockedReason: blockedReason(row, today),
    });
  }
  changes.sort(
    (a, b) =>
      (a.before ?? a.after).scheduledDate.localeCompare((b.before ?? b.after).scheduledDate) ||
      a.id.localeCompare(b.id),
  );
  return {
    changes,
    revision: $security.sha256(
      serialize({
        today,
        changes,
        sessions: rows.map((row) => [
          row.id,
          row.getString("updated"),
          row.getString("status"),
          row.getBool("deleted"),
          row.getString("scheduled_date"),
        ]),
      }),
    ),
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { todayFor, isProtected, compare };
