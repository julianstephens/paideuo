const intensityLevels = ["easy", "moderate", "hard", "maximal", "unspecified"];

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
  const aerobicByModality = {};

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

    if (status === "completed") {
      let sessionAerobic = directAerobicMinutes;
      if (sessionAerobic == null && Array.isArray(componentResults) && Array.isArray(prescription?.components)) {
        sessionAerobic = 0;
        for (const component of prescription.components) {
          if (component.classification !== "aerobic") continue;
          const result = componentResults.find((item) => item.componentKey === component.key);
          aerobicCoverageSpecified++;
          if (!result) continue;
          const minutes =
            result.durationMin ??
            ((result.runningMin ?? 0) + (result.walkingMin ?? 0) || null);
          if (minutes == null) continue;
          aerobicCoverageMeasured++;
          sessionAerobic += minutes;
          const modality =
            (result.aerobicModality ?? result.modality ?? component.modality ?? "").toLowerCase().trim();
          const key = modality || "unspecified";
          aerobicByModality[key] = (aerobicByModality[key] ?? 0) + minutes;
        }
        if (aerobicCoverageMeasured === 0 && sessionAerobic === 0) sessionAerobic = null;
      }
      if (sessionAerobic != null) {
        aerobicMinutes = (aerobicMinutes ?? 0) + sessionAerobic;
      }
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
    aerobicByModality,
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
