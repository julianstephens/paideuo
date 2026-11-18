const sessionTypes = ["climbing", "strength", "conditioning", "mobility", "other"];
const intensityLevels = ["easy", "moderate", "hard", "maximal", "unspecified"];
const dayMs = 86_400_000;
const weekMs = 7 * dayMs;
const lastDate = Date.parse("9999-12-31");
const formatDate = (day) => new Date(day).toISOString().slice(0, 10);

const sessionLoad = (completion) =>
  completion?.actualDurationMin != null && completion.sessionRpe != null
    ? completion.actualDurationMin * completion.sessionRpe
    : null;

const emptyWeek = () => ({
  load: null,
  actualMinutes: null,
  plannedMinutes: null,
  scheduledSessions: 0,
  measuredDurationSessions: 0,
  rpeSum: 0,
  rpeCount: 0,
  measuredLoadSessions: 0,
  completedSessions: 0,
  intensity: Object.fromEntries(intensityLevels.map((level) => [level, 0])),
});

const addSession = (week, session) => {
  week.scheduledSessions++;
  if (session.plannedMinutes != null) {
    week.plannedMinutes = (week.plannedMinutes ?? 0) + session.plannedMinutes;
  }
  week.intensity[session.plannedIntensity ?? "unspecified"]++;
  if (!session.completed) return;

  week.completedSessions++;
  const completion = session.completion;
  if (completion?.actualDurationMin != null) {
    week.measuredDurationSessions++;
    week.actualMinutes = (week.actualMinutes ?? 0) + completion.actualDurationMin;
  }
  if (completion?.sessionRpe != null) {
    week.rpeSum += completion.sessionRpe;
    week.rpeCount++;
  }
  const load = sessionLoad(completion);
  if (load !== null) {
    week.load = (week.load ?? 0) + load;
    week.measuredLoadSessions++;
  }
};

// Scheduled dates are civil dates. Use UTC arithmetic only to index those dates.
const rollup = (sessions, startDate, weekCount) => {
  const start = Date.parse(startDate);
  const lastWeek = Math.floor((lastDate - start) / weekMs);
  let first = 0;
  let last = Math.min(weekCount - 1, lastWeek);
  const byWeek = new Map();
  for (const session of sessions) {
    const index = Math.floor((Date.parse(session.scheduledDate) - start) / weekMs);
    first = Math.min(first, index);
    last = Math.max(last, index);
    if (!byWeek.has(index)) byWeek.set(index, {});
    const week = byWeek.get(index);
    for (const type of ["all", session.sessionType]) {
      week[type] ??= emptyWeek();
      addSession(week[type], session);
    }
  }

  const weeks = [];
  for (let index = first; index <= last; index++) {
    const monday = start + index * weekMs;
    const totals = byWeek.get(index);
    weeks.push({
      startDate: formatDate(monday),
      endDate: formatDate(Math.min(monday + 6 * dayMs, lastDate)),
      totals: Object.fromEntries(
        ["all", ...sessionTypes].map((type) => {
          const { rpeSum, rpeCount, ...total } = totals?.[type] ?? emptyWeek();
          return [type, { ...total, averageRpe: rpeCount ? rpeSum / rpeCount : null }];
        }),
      ),
    });
  }
  return { weeks };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { rollup, sessionLoad };
