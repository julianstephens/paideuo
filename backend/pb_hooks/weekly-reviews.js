const collection = "paideuo_weekly_reviews";
const noteFields = {
  worked: "worked",
  didNotWork: "did_not_work",
  recoveryObservations: "recovery_observations",
  adjustments: "adjustments",
};

const ownProgram = (db, id, owner) => {
  const [program] = db.findRecordsByFilter(
    "paideuo_programs",
    "id = {:id} && owner = {:owner}",
    "",
    1,
    0,
    { id, owner },
  );
  if (!program) throw new NotFoundError("Program not found.");
  return program;
};

const savedContext = (review) => {
  const start = review.getString("start_date");
  return {
    weekId: review.getString("source_week"),
    blockId: review.getString("source_block"),
    label: review.getString("week_label"),
    blockLabel: review.getString("block_label"),
    window: start ? { start, end: review.getString("end_date") } : null,
  };
};

const contextFor = (block, week) => ({
  weekId: week.id,
  blockId: block.id,
  label: week.label,
  blockLabel: block.label,
  window: week.window,
});

const list = (event) => {
  const { sourceGroups } = require(__hooks + "/metrics.js");
  const programId = event.request.pathValue("programId");
  ownProgram(event.app, programId, event.auth.id);
  const rows = event.app.findRecordsByFilter(
    collection,
    "program = {:programId}",
    "-start_date,-updated",
    0,
    0,
    { programId },
  );
  if (!rows.length) return event.json(200, []);
  const [schedule] = event.app.findRecordsByFilter(
    "paideuo_program_schedules",
    "program = {:programId}",
    "",
    1,
    0,
    { programId },
  );
  const current = new Map();
  if (schedule) {
    const { blocks } = sourceGroups(
      event.app,
      programId,
      Date.parse(schedule.getString("start_date")),
      [],
    );
    for (const block of blocks.values()) {
      for (const week of block.weeks.values()) {
        if (week.window) current.set(week.id, contextFor(block, week));
      }
    }
  }
  return event.json(
    200,
    rows.map((row) => {
      const saved = savedContext(row);
      return { ...(current.get(saved.weekId) ?? saved), updated: row.getString("updated") };
    }),
  );
};

const detail = (event) => {
  const programId = event.request.pathValue("programId");
  const weekId = event.request.pathValue("weekId");
  const owner = event.auth.id;
  const saving = event.request.method === "PUT";
  const body = saving ? event.requestInfo().body : null;
  const { todayFor } = require(__hooks + "/schedule-revisions.js");
  const { readSessions, readCheckIns, sourceGroups, summarize, dailyBreakdown } = require(
    __hooks + "/metrics.js",
  );
  let result;
  event.app.runInTransaction((tx) => {
    const program = ownProgram(tx, programId, owner);
    const [stored] = tx.findRecordsByFilter(
      collection,
      "program = {:programId} && source_week = {:weekId}",
      "",
      1,
      0,
      { programId, weekId },
    );
    const [schedule] = tx.findRecordsByFilter(
      "paideuo_program_schedules",
      "program = {:programId}",
      "",
      1,
      0,
      { programId },
    );
    const sessions = schedule
      ? readSessions(
          tx,
          (prefix) => `${prefix}schedule = {:schedule}`,
          { schedule: schedule.id },
          new Map([[schedule.id, todayFor(schedule)]]),
        )
      : [];
    const { blocks } = schedule
      ? sourceGroups(tx, programId, Date.parse(schedule.getString("start_date")), sessions)
      : { blocks: new Map() };
    const block = [...blocks.values()].find(({ weeks }) => weeks.has(weekId));
    const week = block?.weeks.get(weekId);
    if (!stored && !week) throw new NotFoundError("Scheduled week not found.");

    const saved = stored ? savedContext(stored) : null;
    const context = week?.window || !saved ? contextFor(block, week) : saved;
    let record = stored;
    if (saving) {
      record ??= new Record(tx.findCollectionByNameOrId(collection), {
        program: programId,
        source_week: weekId,
      });
      record.set("source_block", context.blockId);
      record.set("week_label", context.label);
      record.set("block_label", context.blockLabel);
      record.set("start_date", context.window?.start ?? "");
      record.set("end_date", context.window?.end ?? "");
      for (const [key, field] of Object.entries(noteFields)) {
        const value = body[key] === undefined ? "" : body[key];
        if (typeof value !== "string" || value.length > 10000) {
          throw new BadRequestError("Each review note must be text of 10,000 characters or fewer.");
        }
        record.set(field, value);
      }
      tx.save(record);
    }
    const editorBlock = blocks.get(context.blockId);
    const entries = readCheckIns(tx, owner, context.window);
    const movementObservations = (week?.sessions ?? []).flatMap((session) =>
      (session.componentResults ?? [])
        .filter((result) => result.observation)
        .map((result) => ({
          sessionId: session.id,
          sessionDate: session.scheduledDate,
          componentKey: result.componentKey,
          componentName:
            session.prescription?.components?.find(
              (component) => component.key === result.componentKey,
            )?.name ?? "Workout component",
          ...result.observation,
        })),
    );
    const weekSessions = week?.sessions ?? [];
    const { progression } = require(__hooks + "/gpp-progression.js");
    result = {
      ...context,
      programName: program.getString("name"),
      editorAvailable: Boolean(editorBlock?.window),
      updated: record?.getString("updated") ?? null,
      notes: Object.fromEntries(
        Object.entries(noteFields).map(([key, field]) => [key, record?.getString(field) ?? ""]),
      ),
      total: summarize(week?.sessions ?? [], entries, context.window),
      trainingAvailable: Boolean(week),
      days: dailyBreakdown(entries, context.window),
      movementObservations,
      progression: progression(weekSessions),
      dataCoverage: {
        scheduledSessions: weekSessions.length,
        completedSessions: weekSessions.filter(({ status }) => status === "completed").length,
        recoveryDays: weekSessions.length
          ? entries.filter(
              ({ date }) =>
                context.window && date >= context.window.start && date <= context.window.end,
            ).length
          : 0,
      },
    };
  });
  return event.json(200, result);
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { list, detail };
