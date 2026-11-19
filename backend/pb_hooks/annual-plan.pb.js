routerAdd(
  "GET",
  "/api/paideuo/annual-plan",
  (event) => {
    const dates = require(__hooks + "/calendar-dates.js");
    const query = event.request.url.query();
    const year = query.get("year");
    const first = dates.parse(year + "-01-01");
    const last = dates.parse(year + "-12-31");
    if (!first || !last) throw new BadRequestError("Choose a valid calendar year.");

    const day = 86_400_000;
    const week = 7 * day;
    const lastSupportedDate = Date.parse("9999-12-31");
    const dateKey = (time) => dates.format(new Date(Math.min(time, lastSupportedDate)));
    const start = dates.format(first);
    const end = dates.format(last);
    const programs = [];
    const workload = new Map();
    event.app.runInTransaction((tx) => {
      const owner = event.auth.id;
      const schedules = tx.findRecordsByFilter(
        "paideuo_program_schedules",
        "program.owner = {:owner} && start_date <= {:end}",
        "start_date,id",
        0,
        0,
        { owner, end },
      );
      tx.expandRecords(schedules, ["program"], null);
      const blocksByProgram = new Map();
      const blocks = tx.findRecordsByFilter(
        "paideuo_blocks",
        "program.owner = {:owner}",
        "position,id",
        0,
        0,
        { owner },
      );
      for (const block of blocks) {
        const id = block.getString("program");
        if (!blocksByProgram.has(id)) blocksByProgram.set(id, []);
        blocksByProgram.get(id).push(block);
      }
      const weeksByBlock = new Map();
      const weeks = tx.findRecordsByFilter(
        "paideuo_program_weeks",
        "block.program.owner = {:owner}",
        "position,id",
        0,
        0,
        { owner },
      );
      for (const row of weeks) {
        const id = row.getString("block");
        if (!weeksByBlock.has(id)) weeksByBlock.set(id, []);
        weeksByBlock.get(id).push(row);
      }
      for (const schedule of schedules) {
        const program = schedule.expandedOne("program");
        const programStart = dates.parse(schedule.getString("start_date")).getTime();
        let cursor = programStart;
        const spans = [];
        for (const block of blocksByProgram.get(program.id) ?? []) {
          const durationWeeks = block.getInt("duration_weeks");
          const blockStart = cursor;
          cursor += durationWeeks * week;
          if (cursor <= first || blockStart > last) continue;
          spans.push({
            id: block.id,
            name: block.getString("name"),
            objective: block.getString("objective"),
            durationWeeks,
            start: dateKey(blockStart),
            end: dateKey(cursor - day),
            weeks: (weeksByBlock.get(block.id) ?? [])
              .map((row) => {
                const position = row.getInt("position");
                const weekStart = blockStart + (position - 1) * week;
                return {
                  id: row.id,
                  position,
                  label: row.getString("label"),
                  recovery: row.getString("week_type") === "recovery",
                  start: dateKey(weekStart),
                  end: dateKey(weekStart + 6 * day),
                };
              })
              .filter(
                (row) => row.position <= durationWeeks && row.start <= end && row.end >= start,
              ),
          });
        }
        if (spans.length) {
          programs.push({
            id: program.id,
            name: program.getString("name"),
            start: dateKey(programStart),
            end: dateKey(cursor - day),
            blocks: spans,
          });
        }
      }

      if (query.get("hours") !== "true") return;
      const sessions = tx.findRecordsByFilter(
        "paideuo_scheduled_sessions",
        "schedule.program.owner = {:owner} && scheduled_date >= {:start} && scheduled_date <= {:end}",
        "scheduled_date",
        0,
        0,
        { owner, start, end },
      );
      for (const session of sessions) {
        const date = dates.parse(session.getString("scheduled_date"));
        const monday = date.getTime() - ((date.getUTCDay() + 6) % 7) * day;
        const key = dateKey(Math.max(monday, first.getTime()));
        if (!workload.has(key)) workload.set(key, { start: key, minutes: 0, missing: 0 });
        const total = workload.get(key);
        const { plannedDurationMin } = JSON.parse(session.getString("prescription_snapshot"));
        if (plannedDurationMin == null) total.missing++;
        else total.minutes += plannedDurationMin;
      }
    });
    return event.json(200, { programs, workload: [...workload.values()] });
  },
  $apis.requireAuth("paideuo_users"),
);
