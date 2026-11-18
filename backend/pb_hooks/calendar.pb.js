routerAdd(
  "GET",
  "/api/paideuo/calendar",
  (event) => {
    const dates = require(__hooks + "/calendar-dates.js");
    const { completionCollection, completionData, state } = require(
      __hooks + "/calendar-sessions.js",
    );
    const query = event.request.url.query();
    const start = query.get("start");
    const end = query.get("end");
    const first = dates.parse(start);
    const last = dates.parse(end);
    if (!first || !last || last < first || last - first > 41 * 86400000) {
      throw new BadRequestError("Choose a valid calendar range of up to 42 days.");
    }
    const includeSummary = query.get("summary") === "true";
    const { calculate } = require(__hooks + "/compliance.js");
    const { todayFor } = require(__hooks + "/schedule-revisions.js");
    let result;
    event.app.runInTransaction((tx) => {
      const range = "scheduled_date >= {:start} && scheduled_date <= {:end}";
      const params = { owner: event.auth.id, start, end };
      const rows = tx.findRecordsByFilter(
        "paideuo_scheduled_sessions",
        "schedule.program.owner = {:owner} && " + range,
        "scheduled_date,slot_position,schedule,source_prescription_id",
        0,
        0,
        params,
      );
      const completions = tx.findRecordsByFilter(
        completionCollection,
        "session.schedule.program.owner = {:owner} && session.scheduled_date >= {:start} && session.scheduled_date <= {:end}",
        "",
        0,
        0,
        params,
      );
      const bySession = new Map(completions.map((record) => [record.getString("session"), record]));
      tx.expandRecords(rows, ["schedule.program"], null);
      const todayByProgram = new Map();
      const sessions = rows.map((row) => {
        const schedule = row.expandedOne("schedule");
        const program = schedule.expandedOne("program");
        if (includeSummary && !todayByProgram.has(program.id)) {
          todayByProgram.set(program.id, todayFor(schedule));
        }
        return {
          id: row.id,
          programId: program.id,
          programName: program.getString("name"),
          timezone: schedule.getString("timezone"),
          scheduledDate: row.getString("scheduled_date"),
          originalDate: row.getString("original_date"),
          manuallyMoved: row.getBool("manually_moved"),
          ...state(row, completionData(bySession.get(row.id))),
          prescription: JSON.parse(row.getString("prescription_snapshot")),
        };
      });
      result = includeSummary
        ? {
            sessions,
            summary: calculate(
              sessions.map((session) => ({
                today: todayByProgram.get(session.programId),
                status: session.status,
                scheduledDate: session.scheduledDate,
                planned: session.prescription.plannedDurationMin ?? null,
                plannedIntensity: session.prescription.plannedIntensity ?? null,
                actual: session.completion?.actualDurationMin ?? null,
              })),
            ),
          }
        : sessions;
    });
    return event.json(200, result);
  },
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "PATCH",
  "/api/paideuo/calendar/sessions/{id}",
  (event) => {
    const dates = require(__hooks + "/calendar-dates.js");
    const { ownSession, state } = require(__hooks + "/calendar-sessions.js");
    const { scheduledDate, revision } = event.requestInfo().body;
    const id = event.request.pathValue("id");
    if (!dates.parse(scheduledDate)) throw new BadRequestError("Choose a valid calendar date.");
    event.app.runInTransaction((tx) => {
      const row = ownSession(tx, id, event.auth.id);
      if (row.getString("status") !== "planned") {
        throw new BadRequestError("Only planned sessions can be moved.");
      }
      if (row.getString("scheduled_date") === scheduledDate) return;
      if (state(row, null).revision !== revision) {
        throw new BadRequestError("This session changed. Reopen it before rescheduling.");
      }
      row.set("scheduled_date", scheduledDate);
      row.set("manually_moved", true);
      tx.save(row);
    });
    return event.json(200, { id, scheduledDate });
  },
  $apis.requireAuth("paideuo_users"),
);

routerAdd(
  "PATCH",
  "/api/paideuo/calendar/sessions/{id}/execution",
  (event) => {
    const { parse } = require(__hooks + "/calendar-dates.js");
    const { todayFor } = require(__hooks + "/schedule-revisions.js");
    const { completionCollection, completionData, ownSession, state } = require(
      __hooks + "/calendar-sessions.js",
    );
    const { action, revision, completion } = event.requestInfo().body;
    const transitions = {
      complete: ["planned", "completed"],
      "edit-completion": ["completed", "completed"],
      skip: ["planned", "skipped"],
      restore: ["skipped", "planned"],
    };
    if (
      typeof action !== "string" ||
      !Object.prototype.hasOwnProperty.call(transitions, action) ||
      typeof revision !== "string"
    ) {
      throw new BadRequestError("Choose a valid session action.");
    }
    const [from, to] = transitions[action];
    let result;
    event.app.runInTransaction((tx) => {
      const id = event.request.pathValue("id");
      const row = ownSession(tx, id, event.auth.id);
      const [record] = tx.findRecordsByFilter(completionCollection, "session = {:id}", "", 1, 0, {
        id,
      });
      const current = state(row, completionData(record));
      let details = null;
      if (to === "completed") {
        const {
          completedDate,
          actualDurationMin = null,
          sessionRpe = null,
          notes = "",
        } = completion ?? {};
        const schedule = tx.findRecordById("paideuo_program_schedules", row.getString("schedule"));
        if (!parse(completedDate) || completedDate > todayFor(schedule)) {
          throw new BadRequestError(
            "Choose a valid completion date through today in the program’s timezone.",
          );
        }
        if (
          actualDurationMin !== null &&
          (!Number.isSafeInteger(actualDurationMin) || actualDurationMin < 0)
        ) {
          throw new BadRequestError(
            "Enter a nonnegative whole number of minutes or clear the duration.",
          );
        }
        if (
          sessionRpe !== null &&
          (!Number.isFinite(sessionRpe) || sessionRpe < 1 || sessionRpe > 10)
        ) {
          throw new BadRequestError("Enter a session RPE from 1 to 10 or clear it.");
        }
        if (typeof notes !== "string" || notes.length > 10000) {
          throw new BadRequestError("Completion notes must be 10,000 characters or fewer.");
        }
        details = { completedDate, actualDurationMin, sessionRpe, notes: notes.trim() };
      }
      if (
        current.status === to &&
        (current.status === from || current.revision !== revision) &&
        JSON.stringify(current.completion) === JSON.stringify(details)
      ) {
        result = current;
        return;
      }
      if (current.revision !== revision) {
        throw new ApiError(409, "This session changed. Reload it before saving.");
      }
      if (current.status !== from)
        throw new BadRequestError("This action is unavailable for the current session status.");
      if (details) {
        const saved =
          record ?? new Record(tx.findCollectionByNameOrId(completionCollection), { session: id });
        saved.set("completed_date", details.completedDate);
        saved.set("actual_duration_min", details.actualDurationMin);
        saved.set("session_rpe", details.sessionRpe);
        saved.set("notes", details.notes);
        tx.save(saved);
      }
      row.set("status", to);
      tx.save(row);
      result = state(row, details);
    });
    return event.json(200, result);
  },
  $apis.requireAuth("paideuo_users"),
);
