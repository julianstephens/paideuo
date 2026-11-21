const day = 86_400_000;
const week = 7 * day;
const lastDate = Date.parse("9999-12-31");
const dateKey = (value) => new Date(value).toISOString().slice(0, 10);
const monday = (value) => value - ((new Date(value).getUTCDay() + 6) % 7) * day;
const windowFor = (start, end) => ({
  start: dateKey(start),
  end: dateKey(Math.min(end, lastDate)),
});
const weekWindow = (start) => windowFor(start, start + 6 * day);

const summarize = (sessions, entries, window) => {
  const { calculate } = require(__hooks + "/compliance.js");
  const { sessionLoad } = require(__hooks + "/training-load.js");
  const checkIns = window
    ? entries.filter(({ date }) => date >= window.start && date <= window.end)
    : [];
  let load = null;
  let measuredLoad = 0;
  let rpeSum = 0;
  let measuredRpe = 0;
  for (const session of sessions) {
    if (session.status !== "completed") continue;
    const rpe = session.completion?.sessionRpe;
    if (rpe != null) {
      rpeSum += rpe;
      measuredRpe++;
    }
    const value = sessionLoad(session.completion);
    if (value === null) continue;
    load = (load ?? 0) + value;
    measuredLoad++;
  }
  const recovery = {};
  for (const key of ["sleepHours", "fatigue", "soreness"]) {
    let sum = 0;
    let count = 0;
    for (const entry of checkIns) {
      const value = entry[key];
      if (value == null) continue;
      sum += value;
      count++;
    }
    recovery[key] = { mean: count ? sum / count : null, count };
  }
  const nutrition = { adequate: 0, likely_insufficient: 0, unsure: 0 };
  for (const { nutritionAdequacy } of checkIns) {
    if (Object.hasOwn(nutrition, nutritionAdequacy)) nutrition[nutritionAdequacy]++;
  }
  return {
    compliance: calculate(sessions),
    load,
    measuredLoad,
    recovery,
    nutrition,
    averageRpe: measuredRpe ? rpeSum / measuredRpe : null,
    measuredRpe,
  };
};

const sourceGroups = (tx, programId, start, sessions) => {
  const blocks = new Map();
  let offset = 0;
  const rows = tx.findRecordsByFilter(
    "paideuo_blocks",
    "program = {:programId}",
    "position,id",
    0,
    0,
    { programId },
  );
  const weeks = tx.findRecordsByFilter(
    "paideuo_program_weeks",
    "block.program = {:programId}",
    "position,id",
    0,
    0,
    { programId },
  );
  for (const row of rows) {
    const duration = row.getInt("duration_weeks");
    const blockStart = start + offset * week;
    const block = {
      id: row.id,
      label: row.getString("name"),
      durationWeeks: duration,
      window:
        blockStart <= lastDate ? windowFor(blockStart, blockStart + duration * week - day) : null,
      weeks: new Map(),
      sessions: [],
    };
    for (const item of weeks) {
      if (item.getString("block") !== row.id) continue;
      const position = item.getInt("position");
      const weekStart = blockStart + (position - 1) * week;
      const label = item.getString("label");
      block.weeks.set(item.id, {
        id: item.id,
        position,
        label: `Week ${position}${label ? " · " + label : ""}`,
        window: weekStart <= lastDate ? weekWindow(weekStart) : null,
        sessions: [],
      });
    }
    blocks.set(row.id, block);
    offset += duration;
  }

  for (const session of sessions) {
    const source = session.source;
    if (!source) continue;
    if (!blocks.has(source.blockId)) {
      blocks.set(source.blockId, {
        id: source.blockId,
        label: source.blockName + " · Historical",
        durationWeeks: null,
        window: null,
        weeks: new Map(),
        sessions: [],
      });
    }
    const block = blocks.get(source.blockId);
    block.sessions.push(session);
    if (!block.weeks.has(source.weekId)) {
      block.weeks.set(source.weekId, {
        id: source.weekId,
        position: source.weekPosition,
        label: `Week ${source.weekPosition}${source.weekLabel ? " · " + source.weekLabel : ""} · Historical`,
        window: null,
        sessions: [],
      });
    }
    block.weeks.get(source.weekId).sessions.push(session);
  }
  return { blocks, window: offset ? windowFor(start, start + offset * week - day) : null };
};

const readSessions = (tx, sessionFilter, params, bySchedule) => {
  const { completionCollection, componentResultCollection, completionData, statusFor } = require(
    __hooks + "/calendar-sessions.js",
  );
  const rows = tx.findRecordsByFilter(
    "paideuo_scheduled_sessions",
    "deleted = false && (" + sessionFilter("") + ")",
    "scheduled_date",
    0,
    0,
    params,
  );
  const completions = tx.findRecordsByFilter(
    completionCollection,
    sessionFilter("session."),
    "",
    0,
    0,
    params,
  );
  const bySession = new Map(
    completions.map((row) => [row.getString("session"), completionData(row)]),
  );
  const { resultData } = require(__hooks + "/component-results.js");
  const resultsBySession = new Map(rows.map(({ id }) => [id, []]));
  if (rows.length) {
    const results = tx.findRecordsByFilter(
      componentResultCollection,
      "completed = true && session.deleted = false && (" + sessionFilter("session.") + ")",
      "session,planned_position,id",
      0,
      0,
      params,
    );
    for (const record of results) {
      resultsBySession.get(record.getString("session"))?.push(resultData(record));
    }
  }
  return rows.map((row) => {
    const snapshot = JSON.parse(row.getString("prescription_snapshot"));
    const completion = bySession.get(row.id);
    const today = bySchedule.get(row.getString("schedule"));
    return {
      id: row.id,
      scheduledDate: row.getString("scheduled_date"),
      today,
      status: statusFor(row, today),
      source: JSON.parse(row.getString("source_attribution") || "null"),
      planned: snapshot.plannedDurationMin ?? null,
      plannedIntensity: snapshot.plannedIntensity ?? null,
      actual: completion?.actualDurationMin ?? null,
      completion,
      prescription: snapshot,
      componentResults: resultsBySession.get(row.id),
    };
  });
};

const readCheckIns = (tx, owner, window) => {
  const { entryData } = require(__hooks + "/daily-check-ins.js");
  return window
    ? tx
        .findRecordsByFilter(
          "paideuo_daily_recovery",
          "owner = {:owner} && date >= {:start} && date <= {:end}",
          "date",
          0,
          0,
          { owner, ...window },
        )
        .map(entryData)
    : [];
};

const dailyBreakdown = (entries, window) => {
  const days = [];
  if (!window) return days;
  for (let cursor = Date.parse(window.start); cursor <= Date.parse(window.end); cursor += day) {
    const period = windowFor(cursor, cursor);
    days.push({ id: period.start, label: "", window: period, ...summarize([], entries, period) });
  }
  return days;
};

const compareBlocks = (event, query) => {
  const { todayFor } = require(__hooks + "/schedule-revisions.js");
  const owner = event.auth.id;
  const leftBlock = query.get("leftBlock");
  const rightBlock = query.get("rightBlock");
  if (!leftBlock || !rightBlock || leftBlock === rightBlock) {
    throw new BadRequestError("Choose two distinct blocks.");
  }
  let result;
  event.app.runInTransaction((tx) => {
    const programs = new Map();
    result = [
      [query.get("leftProgram"), leftBlock],
      [query.get("rightProgram"), rightBlock],
    ].map(([programId, blockId]) => {
      if (!programs.has(programId)) {
        const [schedule] = tx.findRecordsByFilter(
          "paideuo_program_schedules",
          'program = {:programId} && program.owner = {:owner} && (program.status = "completed" || program.status = "archived")',
          "",
          1,
          0,
          { programId, owner },
        );
        if (!schedule) throw new NotFoundError("Historical program not found.");
        const sessions = readSessions(
          tx,
          (prefix) => `${prefix}schedule = {:scheduleId}`,
          { scheduleId: schedule.id },
          new Map([[schedule.id, todayFor(schedule)]]),
        );
        const { blocks } = sourceGroups(
          tx,
          programId,
          Date.parse(schedule.getString("start_date")),
          sessions,
        );
        programs.set(programId, blocks);
      }
      const block = programs.get(programId).get(blockId);
      if (!block) throw new NotFoundError("Historical block not found.");
      const entries = readCheckIns(tx, owner, block.window);
      return {
        durationWeeks: block.durationWeeks,
        id: block.id,
        label: block.label,
        window: block.window,
        ...summarize(block.sessions, entries, block.window),
        weeks: [...block.weeks.values()]
          .sort((a, b) => a.position - b.position)
          .map(({ id, position, label, window, sessions }) => ({
            id,
            position,
            label,
            window,
            ...summarize(sessions, entries, window),
          })),
      };
    });
  });
  return event.json(200, result);
};

const report = (event) => {
  const { parse } = require(__hooks + "/calendar-dates.js");
  const { todayFor } = require(__hooks + "/schedule-revisions.js");
  const query = event.request.url.query();
  const view = query.get("view");
  const programId = query.get("program");
  const owner = event.auth.id;
  if (view === "compare") return compareBlocks(event, query);
  if (!["weekly", "block", "program", "custom"].includes(view)) {
    throw new BadRequestError("Choose a metrics view.");
  }
  if ((view === "block" || view === "program") && !programId) {
    throw new BadRequestError("Choose a scheduled program.");
  }

  let result;
  event.app.runInTransaction((tx) => {
    const scheduleFilter =
      "program.owner = {:owner}" +
      (view !== "custom" && programId ? " && program = {:programId}" : "");
    const params = { owner, programId };
    const schedules = tx.findRecordsByFilter(
      "paideuo_program_schedules",
      scheduleFilter,
      "",
      0,
      0,
      params,
    );
    const [schedule] = schedules;
    if (view !== "custom" && programId && !schedule) {
      throw new NotFoundError("Program schedule not found.");
    }

    const dated = view === "custom" || view === "weekly";
    const startDate = query.get("start");
    const endDate = query.get("end");
    let start = parse(startDate)?.getTime();
    let end = parse(endDate)?.getTime();
    if (view === "weekly" && !startDate && schedule) {
      const programStart = Date.parse(schedule.getString("start_date"));
      const blocks = tx.findRecordsByFilter("paideuo_blocks", "program = {:programId}", "", 0, 0, {
        programId,
      });
      const duration = blocks.reduce((total, block) => total + block.getInt("duration_weeks"), 0);
      const programEnd = Math.min(programStart + Math.max(0, duration * week - day), lastDate);
      const today = Date.parse(todayFor(schedule));
      start = Math.max(programStart, Math.min(today, programEnd));
    }
    if (view === "weekly" && start !== undefined) {
      start = monday(start);
      end = Math.min(start + 6 * day, lastDate);
    }
    if (
      dated &&
      (start === undefined || end === undefined || start > end || end - start >= 366 * day)
    ) {
      throw new BadRequestError("Choose valid dates spanning at most 366 days.");
    }

    const bySchedule = new Map(schedules.map((row) => [row.id, todayFor(row)]));
    const sessionFilter = (prefix) =>
      `${prefix}schedule.program.owner = {:owner}` +
      (view !== "custom" && programId ? ` && ${prefix}schedule.program = {:programId}` : "") +
      (dated ? ` && ${prefix}scheduled_date >= {:start} && ${prefix}scheduled_date <= {:end}` : "");
    if (dated) Object.assign(params, windowFor(start, end));
    const sessions = readSessions(tx, sessionFilter, params, bySchedule);

    let groups;
    let totalSessions = sessions;
    let window;
    let blocks = [];
    let block = null;
    if (dated) {
      window = windowFor(start, end);
      groups = [];
      for (let cursor = monday(start); cursor <= end; cursor += week) {
        const period = windowFor(Math.max(start, cursor), Math.min(end, cursor + 6 * day));
        groups.push({
          id: period.start,
          label: "",
          window: period,
          sessions: sessions.filter(
            ({ scheduledDate }) => scheduledDate >= period.start && scheduledDate <= period.end,
          ),
        });
      }
    } else {
      const source = sourceGroups(
        tx,
        programId,
        Date.parse(schedule.getString("start_date")),
        sessions,
      );
      blocks = [...source.blocks.values()];
      if (view === "program") {
        window = source.window;
        groups = blocks;
      } else {
        block = source.blocks.get(query.get("block")) ?? blocks[0];
        window = block?.window ?? null;
        totalSessions = block?.sessions ?? [];
        groups = [...(block?.weeks.values() ?? [])].sort((a, b) => a.position - b.position);
      }
    }

    const entries = readCheckIns(tx, owner, window);
    const days = view === "weekly" ? dailyBreakdown(entries, window) : [];
    result = {
      days,
      window,
      blockId: block?.id ?? null,
      blocks: blocks.map(({ id, label }) => ({ id, label })),
      unassigned: view === "program" ? sessions.filter(({ source }) => !source).length : 0,
      total: summarize(totalSessions, entries, window),
      periods: groups.map(({ id, label, window: period, sessions }) => ({
        id,
        label,
        window: period,
        ...summarize(sessions, entries, period),
      })),
    };
  });
  return event.json(200, result);
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { report, readSessions, readCheckIns, sourceGroups, summarize, dailyBreakdown };
