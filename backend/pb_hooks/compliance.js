const intensityLevels = ["easy", "moderate", "hard", "maximal", "unspecified"];

const add = (total, value) => (value == null ? total : (total ?? 0) + value);
const longest = (total, value) => (value == null ? total : Math.max(total ?? 0, value));

const plannedAerobic = ({ durationMin, targets }) => {
  const { segments, repetitions = 1, work_seconds, rest_seconds = 0 } = targets ?? {};
  const intervals =
    segments ??
    (work_seconds == null
      ? []
      : [
          { type: "work", duration_seconds: work_seconds },
          { type: "recovery", duration_seconds: rest_seconds },
        ]);
  let minutes = null;
  let running = null;
  let walking = null;
  let bout = null;
  for (const segment of intervals) {
    const repeats = ["work", "recovery"].includes(segment.type) ? repetitions : 1;
    const segmentMinutes = segment.duration_seconds / 60;
    minutes = add(minutes, segmentMinutes * repeats);
    if (segment.modality === "running") running = add(running, segmentMinutes * repeats);
    if (segment.modality === "walking") walking = add(walking, segmentMinutes * repeats);
    if (repeats > 0 && segment.type === "work") bout = longest(bout, segmentMinutes);
  }
  return { minutes: durationMin ?? minutes, running, walking, bout };
};

const calculate = (sessions, today) => {
  const counts = { completed: 0, skipped: 0, pending: 0, unresolved: 0, shortened: 0 };
  const intensity = Object.fromEntries(
    intensityLevels.map((level) => [level, { sessions: 0, plannedMinutes: null }]),
  );
  let plannedMinutes = null;
  let actualMinutes = null;
  let resolvedPlannedMinutes = 0;
  let measuredCompletions = 0;
  let specifiedDurations = 0;
  let aerobicMinutes = null;
  let aerobicCoverageMeasured = 0;
  let aerobicCoverageSpecified = 0;
  const aerobicByModality = Object.create(null);
  let plannedAerobicMinutes = null;
  let plannedRunningMinutes = null;
  let plannedWalkingMinutes = null;
  let plannedContinuousBoutMinutes = null;
  let actualRunningMinutes = null;
  let actualWalkingMinutes = null;
  let actualContinuousBoutMinutes = null;

  for (const {
    status,
    scheduledDate,
    planned,
    actual,
    plannedIntensity,
    today: sessionToday,
    prescription,
    componentResults,
    aerobicMinutes: directAerobicMinutes,
    aerobicByModality: directAerobicByModality,
  } of sessions) {
    if (status === "planned")
      counts[scheduledDate < (sessionToday ?? today) ? "unresolved" : "pending"]++;
    else counts[status]++;

    const level = intensity[plannedIntensity ?? "unspecified"];
    level.sessions++;
    if (planned !== null) {
      specifiedDurations++;
      plannedMinutes = (plannedMinutes ?? 0) + planned;
      level.plannedMinutes = (level.plannedMinutes ?? 0) + planned;
      if (status !== "planned") resolvedPlannedMinutes += planned;
    }
    if (status === "completed" && actual !== null) {
      measuredCompletions++;
      actualMinutes = (actualMinutes ?? 0) + actual;
      if (planned !== null && actual < planned) counts.shortened++;
    }

    let sessionAerobic = null;
    const results = new Map(
      (componentResults ?? []).map((result) => [result.componentKey, result]),
    );
    for (const component of prescription?.components ?? []) {
      if (component.classification !== "aerobic") continue;
      const target = plannedAerobic(component);
      plannedAerobicMinutes = add(plannedAerobicMinutes, target.minutes);
      plannedRunningMinutes = add(plannedRunningMinutes, target.running);
      plannedWalkingMinutes = add(plannedWalkingMinutes, target.walking);
      plannedContinuousBoutMinutes = longest(plannedContinuousBoutMinutes, target.bout);
      if (status !== "completed") continue;

      aerobicCoverageSpecified++;
      const result = results.get(component.key);
      if (!result) continue;
      actualRunningMinutes = add(actualRunningMinutes, result.runningMin);
      actualWalkingMinutes = add(actualWalkingMinutes, result.walkingMin);
      actualContinuousBoutMinutes = longest(actualContinuousBoutMinutes, result.continuousBoutMin);
      const minutes = result.durationMin ?? add(result.runningMin, result.walkingMin) ?? null;
      if (minutes == null) continue;
      aerobicCoverageMeasured++;
      sessionAerobic = add(sessionAerobic, minutes);
      const modality = (result.aerobicModality ?? result.modality ?? component.modality ?? "")
        .toLowerCase()
        .trim();
      const key = modality || "unspecified";
      aerobicByModality[key] = add(aerobicByModality[key], minutes);
    }
    if (status === "completed") {
      aerobicMinutes = add(aerobicMinutes, directAerobicMinutes ?? sessionAerobic);
      if (directAerobicByModality && typeof directAerobicByModality === "object") {
        for (const [modality, minutes] of Object.entries(directAerobicByModality)) {
          if (Number.isFinite(minutes) && minutes >= 0)
            aerobicByModality[modality] = (aerobicByModality[modality] ?? 0) + minutes;
        }
      }
    }
  }

  const resolved = counts.completed + counts.skipped;
  return {
    ...counts,
    scheduled: sessions.length,
    adherence: resolved ? counts.completed / resolved : null,
    plannedMinutes,
    actualMinutes,
    resolvedPlannedMinutes,
    durationAttainment:
      actualMinutes !== null && resolvedPlannedMinutes > 0
        ? actualMinutes / resolvedPlannedMinutes
        : null,
    measuredCompletions,
    specifiedDurations,
    intensity,
    aerobicMinutes,
    plannedAerobicMinutes,
    plannedRunningMinutes,
    plannedWalkingMinutes,
    plannedContinuousBoutMinutes,
    actualRunningMinutes,
    actualWalkingMinutes,
    actualContinuousBoutMinutes,
    aerobicByModality: { ...aerobicByModality },
    aerobicCoverage: {
      measured: aerobicCoverageMeasured,
      specified: aerobicCoverageSpecified,
    },
  };
};

const rollup = (sessions, currentBlocks, today) => {
  const blocks = new Map(
    currentBlocks.map(({ weeks, ...block }) => [
      block.id,
      {
        ...block,
        sessions: [],
        weeks: new Map(weeks.map((week) => [week.id, { ...week, sessions: [] }])),
      },
    ]),
  );
  let unassigned = 0;
  for (const session of sessions) {
    const source = session.source;
    if (!source) {
      unassigned++;
      continue;
    }
    if (!blocks.has(source.blockId)) {
      blocks.set(source.blockId, {
        id: source.blockId,
        name: source.blockName,
        sessions: [],
        weeks: new Map(),
      });
    }
    const block = blocks.get(source.blockId);
    block.sessions.push(session);
    if (!block.weeks.has(source.weekId)) {
      block.weeks.set(source.weekId, {
        id: source.weekId,
        position: source.weekPosition,
        label: source.weekLabel,
        historical: true,
        sessions: [],
      });
    }
    block.weeks.get(source.weekId).sessions.push(session);
  }
  return {
    program: calculate(sessions, today),
    blocks: [...blocks.values()].map((block) => ({
      id: block.id,
      name: block.name,
      total: calculate(block.sessions, today),
      weeks: [...block.weeks.values()]
        .sort(
          (a, b) =>
            a.position - b.position ||
            Number(a.historical) - Number(b.historical) ||
            a.id.localeCompare(b.id),
        )
        .map(({ sessions, ...week }) => ({ ...week, total: calculate(sessions, today) })),
    })),
    unassigned,
  };
};

// oxlint-disable-next-line import/no-commonjs
module.exports = { calculate, rollup };
